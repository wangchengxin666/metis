from __future__ import annotations

import logging
import os
import threading
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from authlib.integrations.starlette_client import OAuth

from .models import OidcProvider
from .security import decrypt_secret

logger = logging.getLogger("dsh-manager.oidc")


def effective_discovery_url(
    issuer_url: str | None, discovery_url: str | None = None
) -> str:
    if discovery_url and discovery_url.strip():
        return discovery_url.strip()
    issuer = (issuer_url or "").strip().rstrip("/")
    if issuer:
        return f"{issuer}/.well-known/openid-configuration"
    return ""


def parse_allowed_domains(allowed_domains: str | None) -> set[str]:
    if not allowed_domains:
        return set()
    return {
        part.strip().lower().lstrip("@")
        for part in allowed_domains.split(",")
        if part.strip()
    }


def is_email_domain_allowed(email: str, allowed_domains: str | None) -> bool:
    allowed = parse_allowed_domains(allowed_domains)
    if not allowed:
        return True
    cleaned = (email or "").strip().lower()
    if "@" not in cleaned:
        return False
    _, domain = cleaned.rsplit("@", 1)
    return domain in allowed


def rewrite_split_horizon_url(
    endpoint: str,
    discovery_url: str | None,
    issuer_url: str | None,
) -> str:
    """Rewrite an internal Docker discovery origin to the browser-facing issuer origin."""
    clean_endpoint = (endpoint or "").strip()
    clean_disc = (discovery_url or "").strip()
    clean_issuer = (issuer_url or "").strip()
    if not clean_endpoint or not clean_disc or not clean_issuer:
        return clean_endpoint

    disc_parts = urlsplit(clean_disc)
    issuer_parts = urlsplit(clean_issuer)
    ep_parts = urlsplit(clean_endpoint)
    if (
        disc_parts.scheme
        and disc_parts.netloc
        and issuer_parts.scheme
        and issuer_parts.netloc
        and ep_parts.scheme == disc_parts.scheme
        and ep_parts.netloc == disc_parts.netloc
        and (ep_parts.scheme, ep_parts.netloc)
        != (issuer_parts.scheme, issuer_parts.netloc)
    ):
        return urlunsplit(
            (
                issuer_parts.scheme,
                issuer_parts.netloc,
                ep_parts.path,
                ep_parts.query,
                ep_parts.fragment,
            )
        )
    return clean_endpoint


class OidcClientRegistry:
    """Thread-safe dynamic Authlib Starlette OAuth client cache keyed by provider slug."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: dict[str, tuple[tuple[Any, ...], Any]] = {}

    @staticmethod
    def _fingerprint(provider: OidcProvider) -> tuple[Any, ...]:
        return (
            provider.id,
            provider.slug,
            provider.client_id,
            provider.client_secret_ciphertext,
            provider.issuer_url,
            provider.discovery_url or "",
            provider.scope,
            os.environ.get("SSL_CERT_FILE", ""),
        )

    def get_client(self, provider: OidcProvider) -> Any:
        discovery = provider.effective_discovery_url
        if not discovery:
            raise ValueError(
                f"OIDC provider '{provider.slug}' has neither issuer_url nor discovery_url"
            )
        fp = self._fingerprint(provider)
        with self._lock:
            cached = self._clients.get(provider.slug)
            if cached is not None and cached[0] == fp:
                return cached[1]

            client_secret = (
                decrypt_secret(provider.client_secret_ciphertext)
                if provider.client_secret_ciphertext
                else None
            )
            client_kwargs: dict[str, Any] = {
                "scope": provider.scope or "openid profile email",
            }
            ssl_cert = os.environ.get("SSL_CERT_FILE")
            if ssl_cert:
                client_kwargs["verify"] = ssl_cert

            oauth = OAuth()
            reg_name = f"oidc_{provider.slug.replace('-', '_')}"
            client = oauth.register(
                name=reg_name,
                client_id=provider.client_id,
                client_secret=client_secret,
                server_metadata_url=discovery,
                client_kwargs=client_kwargs,
            )
            self._clients[provider.slug] = (fp, client)
            return client

    def invalidate(self, slug: str) -> None:
        with self._lock:
            self._clients.pop(slug, None)

    def clear(self) -> None:
        with self._lock:
            self._clients.clear()


async def build_provider_logout_url(
    provider: OidcProvider,
    client: Any,
    manager_base_url: str,
    id_token: str | None = None,
) -> str | None:
    endpoint = (provider.logout_url or "").strip()
    if not endpoint and client is not None:
        metadata: dict[str, Any] = {}
        server_metadata = getattr(client, "server_metadata", None)
        if isinstance(server_metadata, dict) and server_metadata.get(
            "end_session_endpoint"
        ):
            metadata = server_metadata
        elif hasattr(client, "load_server_metadata"):
            try:
                loaded = await client.load_server_metadata()
                if isinstance(loaded, dict):
                    metadata = loaded
            except Exception as exc:
                logger.warning(
                    "Failed to load OIDC discovery metadata for logout (%s): %s",
                    provider.slug,
                    exc,
                )
        endpoint = str(metadata.get("end_session_endpoint") or "").strip()

    if not endpoint:
        return None

    endpoint = rewrite_split_horizon_url(
        endpoint, provider.discovery_url, provider.issuer_url
    )

    query: dict[str, str] = {
        "post_logout_redirect_uri": f"{manager_base_url.rstrip('/')}/login",
    }
    if id_token:
        query["id_token_hint"] = id_token
    if provider.client_id:
        query["client_id"] = provider.client_id

    sep = "&" if "?" in endpoint else "?"
    return f"{endpoint}{sep}{urlencode(query)}"


async def probe_oidc_discovery(
    issuer_url: str | None,
    discovery_url: str | None = None,
) -> dict[str, Any]:
    target = effective_discovery_url(issuer_url, discovery_url)
    if not target:
        return {
            "ok": False,
            "discovery_url": "",
            "detail": "请填写 Issuer URL 或 Discovery URL",
        }
    ssl_cert = os.environ.get("SSL_CERT_FILE")
    verify: bool | str = ssl_cert if ssl_cert else True
    try:
        async with httpx.AsyncClient(
            timeout=10.0, follow_redirects=True, verify=verify
        ) as http:
            resp = await http.get(target)
        if resp.status_code != 200:
            return {
                "ok": False,
                "discovery_url": target,
                "detail": f"Discovery 端点返回 HTTP {resp.status_code}",
            }
        data = resp.json()
        if not isinstance(data, dict):
            return {
                "ok": False,
                "discovery_url": target,
                "detail": "Discovery 响应不是有效的 JSON 对象",
            }
        auth_ep = str(data.get("authorization_endpoint") or "").strip()
        token_ep = str(data.get("token_endpoint") or "").strip()
        if not auth_ep or not token_ep:
            return {
                "ok": False,
                "discovery_url": target,
                "detail": "Discovery JSON 缺少 authorization_endpoint 或 token_endpoint",
            }
        end_session = str(data.get("end_session_endpoint") or "").strip() or None
        return {
            "ok": True,
            "discovery_url": target,
            "issuer": str(data.get("issuer") or "").strip() or None,
            "authorization_endpoint": auth_ep,
            "token_endpoint": token_ep,
            "end_session_endpoint": end_session,
            "supports_logout": bool(end_session),
            "detail": "ok",
        }
    except Exception as exc:
        return {
            "ok": False,
            "discovery_url": target,
            "detail": f"无法连接 Discovery 端点: {exc}",
        }
