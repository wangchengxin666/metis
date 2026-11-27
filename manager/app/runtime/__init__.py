from __future__ import annotations

from ..config import Settings
from .base import (
    AUTH_RESPONSE_HEADERS,
    TAR_CACHE_EXCLUDES,
    BaseSandboxRuntime,
    SandboxRuntimeError,
    build_traefik_dynamic_config,
    format_k8s_cpu,
    llm_provider_identifiers,
    normalize_k8s_memory,
    parse_memory_to_bytes,
    sandbox_traefik_dsh_rule,
    strip_ansi,
)
from .docker_runtime import DockerSandboxRuntime, DockerService
from .k8s_runtime import K8sWorkloadHandle, KubernetesSandboxRuntime


def create_runtime(settings: Settings, auth_resolver=None) -> BaseSandboxRuntime:
    """Instantiate the configured sandbox container runtime ('docker' or 'kubernetes')."""
    if settings.sandbox_runtime == "kubernetes":
        return KubernetesSandboxRuntime(settings)
    return DockerSandboxRuntime(settings, auth_resolver=auth_resolver)


__all__ = [
    "AUTH_RESPONSE_HEADERS",
    "TAR_CACHE_EXCLUDES",
    "BaseSandboxRuntime",
    "DockerSandboxRuntime",
    "DockerService",
    "K8sWorkloadHandle",
    "KubernetesSandboxRuntime",
    "SandboxRuntimeError",
    "build_traefik_dynamic_config",
    "create_runtime",
    "format_k8s_cpu",
    "llm_provider_identifiers",
    "normalize_k8s_memory",
    "parse_memory_to_bytes",
    "sandbox_traefik_dsh_rule",
    "strip_ansi",
]
