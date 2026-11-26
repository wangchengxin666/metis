"""GitHub App JWT signing, Installation Access Token minting, and Enterprise custom-domain helpers."""

from __future__ import annotations

import base64
import json
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from sqlalchemy.orm import Session

from ..models import CredentialProfile, utcnow
from ..security import decrypt_secret, encrypt_secret


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def normalize_git_host(raw_host: str | None) -> str:
    """Extract clean hostname[:port] from a user-supplied host or URL."""
    cleaned = (raw_host or "").strip()
    if not cleaned:
        return "github.com"
    if "://" in cleaned:
        parsed = urlsplit(cleaned)
        host = (parsed.netloc or parsed.path.split("/", 1)[0]).strip()
    else:
        host = cleaned.split("/", 1)[0].strip()
    return host or "github.com"


def resolve_github_web_origin(
    git_host: str | None,
    explicit_api_base: str | None = None,
) -> str:
    """Resolve web origin (scheme + host[:port]) for GitHub Cloud or Enterprise Server."""
    raw = (git_host or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlsplit(raw)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    host = normalize_git_host(raw)
    if host.lower() in {"github.com", "api.github.com"}:
        return "https://github.com"
    scheme = "https"
    if explicit_api_base and explicit_api_base.strip().startswith("http://"):
        scheme = "http"
    return f"{scheme}://{host}".rstrip("/")


def resolve_github_api_base(
    git_host: str | None,
    explicit_api_base: str | None = None,
) -> str:
    """Resolve REST API base URL for github.com, *.ghe.com, or on-prem GitHub Enterprise Server."""
    explicit = (explicit_api_base or "").strip().rstrip("/")
    if explicit:
        parsed = urlsplit(explicit)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("github_api_base_url 必须是有效的 http(s) URL")
        return explicit

    host = normalize_git_host(git_host)
    lower = host.lower()
    if lower in {"github.com", "api.github.com"}:
        return "https://api.github.com"
    if lower.endswith(".ghe.com") and not lower.startswith("api."):
        return f"https://api.{host}"
    origin = resolve_github_web_origin(git_host)
    return f"{origin}/api/v3"


def is_github_profile(
    *,
    git_host: str | None = None,
    github_auth_mode: str = "pat",
    preset_key: str | None = None,
    github_api_base_url: str | None = None,
) -> bool:
    if (github_auth_mode or "pat").strip().lower() == "github_app":
        return True
    if (github_api_base_url or "").strip():
        return True
    pk = (preset_key or "").strip().lower()
    if "github" in pk:
        return True
    host = normalize_git_host(git_host).lower()
    return host == "github.com" or host == "api.github.com" or host.endswith(".ghe.com") or "github" in host


def build_github_app_jwt(
    app_id: str,
    private_key_pem: str,
    *,
    now: int | None = None,
) -> str:
    """Sign a short-lived RS256 JWT for GitHub App authentication using cryptography."""
    clean_app_id = str(app_id or "").strip()
    if not clean_app_id:
        raise ValueError("GitHub App ID 不能为空")
    pem_text = (private_key_pem or "").strip()
    if not pem_text:
        raise ValueError("GitHub App 私钥 (.pem) 不能为空")

    try:
        key = serialization.load_pem_private_key(pem_text.encode("utf-8"), password=None)
    except Exception as exc:
        raise ValueError("无法解析 GitHub App PEM 私钥，请确认格式为 PKCS#1/PKCS#8 且无密码保护") from exc

    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("GitHub App 私钥必须是 RSA 私钥")

    ts = int(now if now is not None else time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8"))
    payload = _b64url(
        json.dumps(
            {
                "iat": ts - 60,
                "exp": ts + 540,
                "iss": clean_app_id,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{payload}.{_b64url(signature)}"


def parse_github_timestamp(raw: str | None) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def mint_installation_access_token(
    *,
    app_id: str,
    installation_id: str,
    private_key_pem: str,
    git_host: str = "github.com",
    api_base_url: str | None = None,
    tls_verify: bool = True,
    http_client: httpx.Client | None = None,
) -> tuple[str, datetime | None]:
    """Exchange a GitHub App RS256 JWT for an Installation Access Token against GitHub or GHES."""
    clean_inst_id = str(installation_id or "").strip()
    if not clean_inst_id:
        raise ValueError("GitHub App Installation ID 不能为空")

    jwt_token = build_github_app_jwt(app_id, private_key_pem)
    api_base = resolve_github_api_base(git_host, api_base_url)
    url = f"{api_base}/app/installations/{clean_inst_id}/access_tokens"
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "metis-dsh-dock",
    }

    verify: bool | str = False
    if tls_verify:
        ssl_cert = (os.environ.get("SSL_CERT_FILE") or "").strip()
        verify = ssl_cert if ssl_cert else True

    if http_client is not None:
        resp = http_client.post(url, headers=headers)
    else:
        with httpx.Client(timeout=20.0, verify=verify) as client:
            resp = client.post(url, headers=headers)

    if resp.status_code not in {200, 201}:
        msg = ""
        try:
            body = resp.json()
            if isinstance(body, dict):
                msg = str(body.get("message") or "").strip()
        except Exception:
            msg = ""
        suffix = f" ({msg})" if msg else ""
        raise ValueError(
            f"GitHub App 换取 Installation Token 失败: HTTP {resp.status_code} @ {api_base}{suffix}"
        )

    data = resp.json() if resp.content else {}
    token = str(data.get("token") or "").strip()
    if not token:
        raise ValueError("GitHub App 接口未返回有效 token")
    expires_at = parse_github_timestamp(data.get("expires_at"))
    return token, expires_at


def ensure_fresh_github_app_token(
    db: Session,
    profile: CredentialProfile,
    *,
    force_refresh: bool = False,
    min_ttl_seconds: int = 600,
    http_client: httpx.Client | None = None,
) -> str:
    """Return a valid cached Installation Token or mint and persist a fresh one if missing/expiring."""
    now = utcnow()
    if not force_refresh and profile.github_app_cached_token_ciphertext:
        exp = profile.github_app_token_expires_at
        if exp is None or exp > now + timedelta(seconds=min_ttl_seconds):
            try:
                cached = decrypt_secret(profile.github_app_cached_token_ciphertext)
                if cached.strip():
                    return cached.strip()
            except Exception:
                pass

    if not profile.github_app_private_key_ciphertext:
        raise ValueError(f"凭据包「{profile.name}」为 GitHub App 模式，但尚未配置 App 私钥 (.pem)")
    pem = decrypt_secret(profile.github_app_private_key_ciphertext)
    token, expires_at = mint_installation_access_token(
        app_id=profile.github_app_id or "",
        installation_id=profile.github_app_installation_id or "",
        private_key_pem=pem,
        git_host=profile.git_host or "github.com",
        api_base_url=profile.github_api_base_url,
        tls_verify=bool(getattr(profile, "github_tls_verify", True)),
        http_client=http_client,
    )
    profile.github_app_cached_token_ciphertext = encrypt_secret(token)
    profile.github_app_token_expires_at = expires_at or (now + timedelta(minutes=55))
    db.flush()
    return token
