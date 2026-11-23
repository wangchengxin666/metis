from __future__ import annotations

from typing import Any

from ..config import Settings
from ..models import Sandbox

AUTH_RESPONSE_HEADERS = [
    "X-Auth-Request-Email",
    "X-Forwarded-User",
    "X-Sandbox-Owner",
    "X-Auth-Request-Name",
    "X-Auth-Request-Admin",
    "X-Sandbox-Owner-Name",
    "X-Metis-Gateway-Auth",
]


def sandbox_traefik_dsh_rule(slug: str) -> str:
    return (
        f"Path(`/s/{slug}`) || "
        f"Path(`/s/{slug}/`) || "
        f"Path(`/s/{slug}/_dsh-token`) || "
        f"Path(`/s/{slug}/dsh`) || "
        f"PathPrefix(`/s/{slug}/dsh/`)"
    )


def build_traefik_dynamic_config(
    settings: Settings,
    sandboxes_with_upstreams: list[tuple[Sandbox, str]],
) -> dict[str, Any]:
    """Build Traefik v3 HTTP Provider dynamic configuration for all running sandboxes.

    Works identically across Local Docker, Remote Docker (mapped host ports), and Kubernetes Services.
    """
    routers: dict[str, Any] = {}
    middlewares: dict[str, Any] = {}
    services: dict[str, Any] = {}

    entrypoint = (settings.traefik_entrypoint or "web").strip() or "web"
    manager_internal = settings.sandbox_reachable_manager_url

    for sandbox, upstream_url in sandboxes_with_upstreams:
        if not upstream_url:
            continue
        slug = sandbox.slug
        router_name = f"dsh-sbx-{slug}"
        dsh_router_name = f"dsh-sbx-{slug}-dsh"
        auth_mw = f"dsh-auth-{slug}"
        verify_url = f"{manager_internal}/api/auth/verify-sandbox/{slug}"

        preview_mode = getattr(sandbox, "preview_auth_mode", None) or "public"
        if preview_mode == "authenticated":
            routers[f"{router_name}-mesh"] = {
                "rule": f"PathPrefix(`/s/{slug}/p/4090`)",
                "entryPoints": [entrypoint],
                "priority": 115,
                "service": router_name,
            }
            routers[router_name] = {
                "rule": f"PathPrefix(`/s/{slug}`)",
                "entryPoints": [entrypoint],
                "priority": 100,
                "service": router_name,
                "middlewares": [auth_mw],
            }
        else:
            routers[router_name] = {
                "rule": f"PathPrefix(`/s/{slug}`)",
                "entryPoints": [entrypoint],
                "priority": 100,
                "service": router_name,
            }
        routers[dsh_router_name] = {
            "rule": sandbox_traefik_dsh_rule(slug),
            "entryPoints": [entrypoint],
            "priority": 120,
            "service": router_name,
            "middlewares": [auth_mw],
        }
        middlewares[auth_mw] = {
            "forwardAuth": {
                "address": verify_url,
                "trustForwardHeader": True,
                "authResponseHeaders": list(AUTH_RESPONSE_HEADERS),
            }
        }
        services[router_name] = {
            "loadBalancer": {
                "servers": [{"url": upstream_url}],
            }
        }

    if not routers:
        return {}
    return {
        "http": {
            "routers": routers,
            "middlewares": middlewares,
            "services": services,
        }
    }
