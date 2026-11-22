from __future__ import annotations

import base64
import datetime as dt
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import Settings
from ..models import Sandbox
from .base import (
    AUTH_RESPONSE_HEADERS,
    TAR_CACHE_EXCLUDES,
    BaseSandboxRuntime,
    SandboxRuntimeError,
    format_k8s_cpu,
    normalize_k8s_memory,
    parse_memory_to_bytes,
    sandbox_traefik_dsh_rule,
    strip_ansi,
)


def _parse_k8s_cpu_to_cores(raw_cpu: str | int | float | None) -> float:
    if raw_cpu is None:
        return 0.0
    s = str(raw_cpu).strip()
    if not s:
        return 0.0
    if s.endswith("n"):
        return float(s[:-1] or "0") / 1_000_000_000.0
    if s.endswith("u"):
        return float(s[:-1] or "0") / 1_000_000.0
    if s.endswith("m"):
        return float(s[:-1] or "0") / 1_000.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_k8s_memory_quantity(raw_mem: str | int | None) -> int:
    if raw_mem is None:
        return 0
    s = str(raw_mem).strip()
    if not s:
        return 0
    multipliers = (
        ("Ki", 1024),
        ("Mi", 1024**2),
        ("Gi", 1024**3),
        ("Ti", 1024**4),
        ("K", 1000),
        ("M", 1000**2),
        ("G", 1000**3),
        ("k", 1000),
        ("m", 1000**2),
        ("g", 1000**3),
    )
    for suffix, mult in multipliers:
        if s.endswith(suffix):
            try:
                return int(float(s[: -len(suffix)]) * mult)
            except ValueError:
                return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


@dataclass
class K8sWorkloadHandle:
    """Lightweight container-like handle returned by KubernetesSandboxRuntime.create() / get()."""

    runtime: KubernetesSandboxRuntime
    sandbox: Sandbox
    id: str
    status: str = "running"

    def reload(self) -> None:
        self.status = self.runtime.status(self.sandbox)


class KubernetesSandboxRuntime(BaseSandboxRuntime):
    """Kubernetes sandbox runtime using per-sandbox StatefulSet (replicas 1<->0), PVC, Service, and Traefik."""

    runtime_name = "kubernetes"

    def __init__(self, settings: Settings):
        super().__init__(settings)
        self._core_v1: Any = None
        self._apps_v1: Any = None
        self._custom_objects: Any = None
        self._api_loaded = False

    @property
    def namespace(self) -> str:
        return (self.settings.k8s_namespace or "dsh-sandboxes").strip() or "dsh-sandboxes"

    def _ensure_k8s_clients(self) -> None:
        if self._api_loaded or (self._core_v1 is not None and self._apps_v1 is not None):
            return
        try:
            from kubernetes import client as k8s_client
            from kubernetes import config as k8s_config
        except ImportError as exc:
            raise SandboxRuntimeError(
                "kubernetes python package is required when SANDBOX_RUNTIME=kubernetes; "
                "install it with: pip install kubernetes"
            ) from exc

        kubeconfig = (self.settings.k8s_kubeconfig_path or "").strip() or None
        context = (self.settings.k8s_context or "").strip() or None
        try:
            if self.settings.k8s_in_cluster and not kubeconfig:
                try:
                    k8s_config.load_incluster_config()
                except Exception:
                    k8s_config.load_kube_config(config_file=kubeconfig, context=context)
            else:
                k8s_config.load_kube_config(config_file=kubeconfig, context=context)
        except Exception as exc:
            raise SandboxRuntimeError(f"failed to load Kubernetes configuration: {exc}") from exc

        self._core_v1 = k8s_client.CoreV1Api()
        self._apps_v1 = k8s_client.AppsV1Api()
        self._custom_objects = k8s_client.CustomObjectsApi()
        self._api_loaded = True

    @property
    def core_v1(self) -> Any:
        self._ensure_k8s_clients()
        return self._core_v1

    @property
    def apps_v1(self) -> Any:
        self._ensure_k8s_clients()
        return self._apps_v1

    @property
    def custom_objects(self) -> Any:
        self._ensure_k8s_clients()
        return self._custom_objects

    @staticmethod
    def _is_not_found(exc: Exception) -> bool:
        return getattr(exc, "status", None) == 404

    @staticmethod
    def _is_already_exists(exc: Exception) -> bool:
        return getattr(exc, "status", None) == 409

    def workload_name(self, sandbox: Sandbox) -> str:
        return self.container_name(sandbox)

    def pod_name(self, sandbox: Sandbox) -> str:
        return f"{self.workload_name(sandbox)}-0"

    def pvc_name(self, sandbox: Sandbox) -> str:
        return (sandbox.volume_name or f"dsh-{sandbox.slug}-home").strip()

    def secret_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}-env"

    def ca_configmap_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}-ca"

    def service_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}"

    def middleware_name(self, sandbox: Sandbox) -> str:
        return f"dsh-auth-{sandbox.slug}"

    def ingress_route_name(self, sandbox: Sandbox) -> str:
        return f"dsh-sbx-{sandbox.slug}"

    def _common_labels(self, sandbox: Sandbox) -> dict[str, str]:
        return {
            "app.kubernetes.io/name": "dsh-sandbox",
            "app.kubernetes.io/instance": f"dsh-sbx-{sandbox.slug}",
            "app.kubernetes.io/managed-by": "dsh-manager",
            "dsh.managed": "true",
            "dsh.slug": sandbox.slug,
            "dsh.template": (sandbox.template or "agent-os")[:63],
        }

    def ping(self) -> bool:
        try:
            self.core_v1.read_namespace(name=self.namespace)
            return True
        except Exception as exc:
            if self._is_not_found(exc):
                return True
            raise SandboxRuntimeError(f"kubernetes ping failed: {exc}") from exc

    def list_local_images(self) -> list[dict[str, str | float]]:
        full = self.image_for(self.settings.dsh_image_tag, self.settings.dsh_image_repo)
        return [
            {
                "full_name": full,
                "repo": self.settings.dsh_image_repo,
                "tag": self.settings.dsh_image_tag,
                "id": "k8s-registry",
                "size_mb": 0.0,
            }
        ]

    def upstream_origin(self, sandbox: Sandbox) -> str:
        public_host = (self.settings.k8s_public_host or "").strip()
        if public_host or self.settings.k8s_service_type == "NodePort":
            host = public_host or "127.0.0.1"
            try:
                svc = self.core_v1.read_namespaced_service(
                    name=self.service_name(sandbox), namespace=self.namespace
                )
                ports = getattr(getattr(svc, "spec", None), "ports", None) or []
                if ports:
                    first = ports[0]
                    node_port = (
                        first.get("nodePort")
                        if isinstance(first, dict)
                        else getattr(first, "node_port", None)
                    )
                    if node_port:
                        return f"http://{host}:{node_port}"
            except Exception:
                pass
        domain = (self.settings.k8s_service_domain or "cluster.local").strip() or "cluster.local"
        return f"http://{self.service_name(sandbox)}.{self.namespace}.svc.{domain}:8080"

    def _ensure_namespace(self) -> None:
        try:
            self.core_v1.read_namespace(name=self.namespace)
        except Exception as exc:
            if not self._is_not_found(exc):
                raise SandboxRuntimeError(f"failed to check namespace {self.namespace}: {exc}") from exc
            body = {
                "apiVersion": "v1",
                "kind": "Namespace",
                "metadata": {
                    "name": self.namespace,
                    "labels": {"app.kubernetes.io/managed-by": "dsh-manager"},
                },
            }
            try:
                self.core_v1.create_namespace(body=body)
            except Exception as create_exc:
                if not self._is_already_exists(create_exc):
                    raise SandboxRuntimeError(
                        f"failed to create namespace {self.namespace}: {create_exc}"
                    ) from create_exc

    def _upsert_env_secret(self, sandbox: Sandbox) -> None:
        name = self.secret_name(sandbox)
        body = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": self._common_labels(sandbox),
            },
            "type": "Opaque",
            "stringData": self.environment(sandbox),
        }
        try:
            self.core_v1.read_namespaced_secret(name=name, namespace=self.namespace)
            self.core_v1.replace_namespaced_secret(name=name, namespace=self.namespace, body=body)
        except Exception as exc:
            if self._is_not_found(exc):
                self.core_v1.create_namespaced_secret(namespace=self.namespace, body=body)
            else:
                raise SandboxRuntimeError(f"failed to upsert secret {name}: {exc}") from exc

    def _upsert_ca_configmap(self, sandbox: Sandbox) -> bool:
        if not self.settings.custom_ca_bundle_path:
            return False
        ca_path = Path(self.settings.custom_ca_bundle_path)
        if not ca_path.is_file():
            return False
        pem_text = ca_path.read_text(encoding="utf-8", errors="replace")
        name = self.ca_configmap_name(sandbox)
        body = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": self._common_labels(sandbox),
            },
            "data": {"custom-ca.crt": pem_text},
        }
        try:
            self.core_v1.read_namespaced_config_map(name=name, namespace=self.namespace)
            self.core_v1.replace_namespaced_config_map(name=name, namespace=self.namespace, body=body)
        except Exception as exc:
            if self._is_not_found(exc):
                self.core_v1.create_namespaced_config_map(namespace=self.namespace, body=body)
            else:
                raise SandboxRuntimeError(f"failed to upsert CA ConfigMap {name}: {exc}") from exc
        return True

    def _ensure_pvc(self, sandbox: Sandbox) -> None:
        name = self.pvc_name(sandbox)
        try:
            self.core_v1.read_namespaced_persistent_volume_claim(name=name, namespace=self.namespace)
            return
        except Exception as exc:
            if not self._is_not_found(exc):
                raise SandboxRuntimeError(f"failed to read PVC {name}: {exc}") from exc

        spec: dict[str, Any] = {
            "accessModes": ["ReadWriteOnce"],
            "resources": {
                "requests": {
                    "storage": (self.settings.k8s_workspace_storage_size or "20Gi").strip()
                }
            },
        }
        storage_class = (self.settings.k8s_storage_class or "").strip()
        if storage_class:
            spec["storageClassName"] = storage_class

        body = {
            "apiVersion": "v1",
            "kind": "PersistentVolumeClaim",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": self._common_labels(sandbox),
                "annotations": {"dsh.owner": sandbox.user.email},
            },
            "spec": spec,
        }
        try:
            self.core_v1.create_namespaced_persistent_volume_claim(
                namespace=self.namespace, body=body
            )
        except Exception as exc:
            if not self._is_already_exists(exc):
                raise SandboxRuntimeError(f"failed to create PVC {name}: {exc}") from exc

    def _upsert_service(self, sandbox: Sandbox) -> None:
        name = self.service_name(sandbox)
        selector = {"dsh.managed": "true", "dsh.slug": sandbox.slug}
        svc_type = (
            "NodePort"
            if (
                self.settings.k8s_service_type == "NodePort"
                or (self.settings.k8s_public_host or "").strip()
            )
            else "ClusterIP"
        )
        body = {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": self._common_labels(sandbox),
            },
            "spec": {
                "type": svc_type,
                "selector": selector,
                "ports": [
                    {
                        "name": "http",
                        "port": 8080,
                        "targetPort": 8080,
                        "protocol": "TCP",
                    }
                ],
            },
        }
        try:
            self.core_v1.read_namespaced_service(name=name, namespace=self.namespace)
            self.core_v1.patch_namespaced_service(name=name, namespace=self.namespace, body=body)
        except Exception as exc:
            if self._is_not_found(exc):
                self.core_v1.create_namespaced_service(namespace=self.namespace, body=body)
            else:
                raise SandboxRuntimeError(f"failed to upsert service {name}: {exc}") from exc

    def _build_statefulset_manifest(
        self,
        sandbox: Sandbox,
        *,
        replicas: int = 1,
        has_ca_configmap: bool = False,
        restarted_at: str | None = None,
    ) -> dict[str, Any]:
        name = self.workload_name(sandbox)
        labels = self._common_labels(sandbox)
        selector_labels = {"dsh.managed": "true", "dsh.slug": sandbox.slug}

        cpus = sandbox.cpu_limit or self.settings.sandbox_cpus
        cpu_limit_qty = format_k8s_cpu(cpus, self.settings.sandbox_cpus)
        cpu_request_qty = format_k8s_cpu(max(cpus / 4.0, 0.1), 0.25)
        mem_limit_qty = normalize_k8s_memory(sandbox.memory_limit, self.settings.sandbox_memory)

        volume_mounts: list[dict[str, Any]] = [
            {"name": "workspace", "mountPath": "/home/workspace"}
        ]
        volumes: list[dict[str, Any]] = [
            {
                "name": "workspace",
                "persistentVolumeClaim": {"claimName": self.pvc_name(sandbox)},
            }
        ]
        if has_ca_configmap:
            volume_mounts.append(
                {
                    "name": "custom-ca",
                    "mountPath": "/etc/dsh/ca/custom-ca.crt",
                    "subPath": "custom-ca.crt",
                    "readOnly": True,
                }
            )
            volumes.append(
                {
                    "name": "custom-ca",
                    "configMap": {"name": self.ca_configmap_name(sandbox)},
                }
            )

        pod_annotations: dict[str, str] = {"dsh.owner": sandbox.user.email}
        if restarted_at:
            pod_annotations["kubectl.kubernetes.io/restartedAt"] = restarted_at

        pod_spec: dict[str, Any] = {
            "automountServiceAccountToken": False,
            "enableServiceLinks": False,
            "terminationGracePeriodSeconds": 20,
            "containers": [
                {
                    "name": "sandbox",
                    "image": self.image_for(sandbox.image_tag, sandbox.image_repo),
                    "imagePullPolicy": self.settings.k8s_image_pull_policy,
                    "ports": [
                        {"name": "http", "containerPort": 8080, "protocol": "TCP"}
                    ],
                    "envFrom": [
                        {"secretRef": {"name": self.secret_name(sandbox)}}
                    ],
                    "resources": {
                        "requests": {
                            "cpu": cpu_request_qty,
                            "memory": mem_limit_qty,
                        },
                        "limits": {
                            "cpu": cpu_limit_qty,
                            "memory": mem_limit_qty,
                        },
                    },
                    "securityContext": {
                        "allowPrivilegeEscalation": False,
                    },
                    "readinessProbe": {
                        "httpGet": {"path": "/healthz", "port": 8080},
                        "initialDelaySeconds": 2,
                        "periodSeconds": 3,
                        "timeoutSeconds": 2,
                    },
                    "volumeMounts": volume_mounts,
                }
            ],
            "volumes": volumes,
        }
        pull_secret = (self.settings.k8s_image_pull_secret or "").strip()
        if pull_secret:
            pod_spec["imagePullSecrets"] = [{"name": pull_secret}]

        return {
            "apiVersion": "apps/v1",
            "kind": "StatefulSet",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": labels,
                "annotations": {"dsh.owner": sandbox.user.email},
            },
            "spec": {
                "serviceName": self.service_name(sandbox),
                "replicas": replicas,
                "podManagementPolicy": "Parallel",
                "selector": {"matchLabels": selector_labels},
                "template": {
                    "metadata": {
                        "labels": labels,
                        "annotations": pod_annotations,
                    },
                    "spec": pod_spec,
                },
            },
        }

    def _upsert_statefulset(
        self,
        sandbox: Sandbox,
        *,
        replicas: int = 1,
        has_ca_configmap: bool = False,
        restarted_at: str | None = None,
    ) -> None:
        name = self.workload_name(sandbox)
        body = self._build_statefulset_manifest(
            sandbox,
            replicas=replicas,
            has_ca_configmap=has_ca_configmap,
            restarted_at=restarted_at,
        )
        try:
            self.apps_v1.read_namespaced_stateful_set(name=name, namespace=self.namespace)
            self.apps_v1.patch_namespaced_stateful_set(name=name, namespace=self.namespace, body=body)
        except Exception as exc:
            if self._is_not_found(exc):
                self.apps_v1.create_namespaced_stateful_set(namespace=self.namespace, body=body)
            else:
                raise SandboxRuntimeError(f"failed to upsert StatefulSet {name}: {exc}") from exc

    def _apply_traefik_crds(self, sandbox: Sandbox) -> None:
        if self.settings.k8s_routing_mode != "traefik-crd":
            return
        mw_name = self.middleware_name(sandbox)
        ir_name = self.ingress_route_name(sandbox)
        verify_url = (
            f"{self.settings.sandbox_reachable_manager_url}"
            f"/api/auth/verify-sandbox/{sandbox.slug}"
        )
        entrypoint = (self.settings.k8s_traefik_entrypoint or "web").strip() or "web"
        labels = self._common_labels(sandbox)

        mw_body = {
            "apiVersion": "traefik.io/v1alpha1",
            "kind": "Middleware",
            "metadata": {
                "name": mw_name,
                "namespace": self.namespace,
                "labels": labels,
            },
            "spec": {
                "forwardAuth": {
                    "address": verify_url,
                    "trustForwardHeader": True,
                    "authResponseHeaders": list(AUTH_RESPONSE_HEADERS),
                }
            },
        }
        ir_body = {
            "apiVersion": "traefik.io/v1alpha1",
            "kind": "IngressRoute",
            "metadata": {
                "name": ir_name,
                "namespace": self.namespace,
                "labels": labels,
            },
            "spec": {
                "entryPoints": [entrypoint],
                "routes": [
                    {
                        "match": f"PathPrefix(`/s/{sandbox.slug}`)",
                        "kind": "Rule",
                        "priority": 100,
                        "services": [
                            {"name": self.service_name(sandbox), "port": 8080}
                        ],
                    },
                    {
                        "match": sandbox_traefik_dsh_rule(sandbox.slug),
                        "kind": "Rule",
                        "priority": 120,
                        "middlewares": [
                            {"name": mw_name, "namespace": self.namespace}
                        ],
                        "services": [
                            {"name": self.service_name(sandbox), "port": 8080}
                        ],
                    },
                ],
            },
        }

        for plural, name, body in (
            ("middlewares", mw_name, mw_body),
            ("ingressroutes", ir_name, ir_body),
        ):
            try:
                existing = self.custom_objects.get_namespaced_custom_object(
                    group="traefik.io",
                    version="v1alpha1",
                    namespace=self.namespace,
                    plural=plural,
                    name=name,
                )
                if isinstance(existing, dict) and existing.get("metadata", {}).get("resourceVersion"):
                    body["metadata"]["resourceVersion"] = existing["metadata"]["resourceVersion"]
                self.custom_objects.replace_namespaced_custom_object(
                    group="traefik.io",
                    version="v1alpha1",
                    namespace=self.namespace,
                    plural=plural,
                    name=name,
                    body=body,
                )
            except Exception as exc:
                if self._is_not_found(exc):
                    self.custom_objects.create_namespaced_custom_object(
                        group="traefik.io",
                        version="v1alpha1",
                        namespace=self.namespace,
                        plural=plural,
                        body=body,
                    )
                else:
                    raise SandboxRuntimeError(
                        f"failed to apply Traefik {plural}/{name}: {exc}"
                    ) from exc

    def _delete_traefik_ingress_route(
        self, sandbox: Sandbox, *, include_middleware: bool = False
    ) -> None:
        if self.settings.k8s_routing_mode != "traefik-crd":
            return
        targets = [("ingressroutes", self.ingress_route_name(sandbox))]
        if include_middleware:
            targets.append(("middlewares", self.middleware_name(sandbox)))
        for plural, name in targets:
            try:
                self.custom_objects.delete_namespaced_custom_object(
                    group="traefik.io",
                    version="v1alpha1",
                    namespace=self.namespace,
                    plural=plural,
                    name=name,
                )
            except Exception as exc:
                if not self._is_not_found(exc):
                    raise SandboxRuntimeError(
                        f"failed to delete Traefik {plural}/{name}: {exc}"
                    ) from exc

    def create(self, sandbox: Sandbox) -> K8sWorkloadHandle:
        self._ensure_namespace()
        self._upsert_env_secret(sandbox)
        has_ca = self._upsert_ca_configmap(sandbox)
        self._ensure_pvc(sandbox)
        self._upsert_service(sandbox)
        self._upsert_statefulset(sandbox, replicas=1, has_ca_configmap=has_ca)
        self._apply_traefik_crds(sandbox)
        return K8sWorkloadHandle(
            runtime=self,
            sandbox=sandbox,
            id=f"k8s:{self.namespace}/{self.workload_name(sandbox)}",
            status="starting",
        )

    def get(self, sandbox: Sandbox) -> K8sWorkloadHandle:
        name = self.workload_name(sandbox)
        try:
            self.apps_v1.read_namespaced_stateful_set(name=name, namespace=self.namespace)
        except Exception as exc:
            if self._is_not_found(exc):
                raise SandboxRuntimeError(
                    f"statefulset for {sandbox.slug} not found"
                ) from exc
            raise SandboxRuntimeError(f"failed to inspect {sandbox.slug}: {exc}") from exc
        current_status = self.status(sandbox)
        return K8sWorkloadHandle(
            runtime=self,
            sandbox=sandbox,
            id=sandbox.container_id or f"k8s:{self.namespace}/{name}",
            status=current_status,
        )

    def _scale_statefulset(self, sandbox: Sandbox, replicas: int) -> None:
        name = self.workload_name(sandbox)
        try:
            self.apps_v1.patch_namespaced_stateful_set(
                name=name,
                namespace=self.namespace,
                body={"spec": {"replicas": replicas}},
            )
        except Exception as exc:
            if self._is_not_found(exc):
                raise SandboxRuntimeError(
                    f"statefulset for {sandbox.slug} not found"
                ) from exc
            raise SandboxRuntimeError(f"failed to scale {sandbox.slug}: {exc}") from exc

    def start(self, sandbox: Sandbox) -> str:
        self._scale_statefulset(sandbox, replicas=1)
        self._apply_traefik_crds(sandbox)
        return "running"

    def stop(self, sandbox: Sandbox) -> str:
        # Remove Traefik CRD route while sleeping so /s/<slug>/* falls through to Manager auto-wake UI
        self._delete_traefik_ingress_route(sandbox, include_middleware=False)
        self._scale_statefulset(sandbox, replicas=0)
        return "stopped"

    def _delete_pod_if_exists(self, sandbox: Sandbox) -> None:
        try:
            self.core_v1.delete_namespaced_pod(
                name=self.pod_name(sandbox),
                namespace=self.namespace,
                grace_period_seconds=5,
            )
        except Exception as exc:
            if not self._is_not_found(exc):
                pass

    def restart(self, sandbox: Sandbox) -> str:
        name = self.workload_name(sandbox)
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        patch = {
            "spec": {
                "replicas": 1,
                "template": {
                    "metadata": {
                        "annotations": {"kubectl.kubernetes.io/restartedAt": now_iso}
                    }
                },
            }
        }
        try:
            self.apps_v1.patch_namespaced_stateful_set(
                name=name, namespace=self.namespace, body=patch
            )
        except Exception as exc:
            if self._is_not_found(exc):
                raise SandboxRuntimeError(
                    f"statefulset for {sandbox.slug} not found"
                ) from exc
            raise SandboxRuntimeError(f"failed to restart {sandbox.slug}: {exc}") from exc
        self._delete_pod_if_exists(sandbox)
        self._apply_traefik_crds(sandbox)
        return "running"

    def update_limits(self, sandbox: Sandbox) -> None:
        name = self.workload_name(sandbox)
        cpus = sandbox.cpu_limit or self.settings.sandbox_cpus
        cpu_limit_qty = format_k8s_cpu(cpus, self.settings.sandbox_cpus)
        cpu_request_qty = format_k8s_cpu(max(cpus / 4.0, 0.1), 0.25)
        mem_limit_qty = normalize_k8s_memory(sandbox.memory_limit, self.settings.sandbox_memory)
        patch = {
            "spec": {
                "template": {
                    "spec": {
                        "containers": [
                            {
                                "name": "sandbox",
                                "resources": {
                                    "requests": {
                                        "cpu": cpu_request_qty,
                                        "memory": mem_limit_qty,
                                    },
                                    "limits": {
                                        "cpu": cpu_limit_qty,
                                        "memory": mem_limit_qty,
                                    },
                                },
                            }
                        ]
                    }
                }
            }
        }
        try:
            self.apps_v1.patch_namespaced_stateful_set(
                name=name, namespace=self.namespace, body=patch
            )
        except Exception as exc:
            raise SandboxRuntimeError(f"limit update failed: {exc}") from exc

    def recreate(self, sandbox: Sandbox) -> None:
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        self._upsert_env_secret(sandbox)
        has_ca = self._upsert_ca_configmap(sandbox)
        self._upsert_statefulset(
            sandbox, replicas=1, has_ca_configmap=has_ca, restarted_at=now_iso
        )
        self._delete_pod_if_exists(sandbox)
        self._apply_traefik_crds(sandbox)
        sandbox.container_id = f"k8s:{self.namespace}/{self.workload_name(sandbox)}"
        self.wait_healthy(sandbox)

    def _pod_ready_and_phase(self, sandbox: Sandbox) -> tuple[bool, str]:
        try:
            pod = self.core_v1.read_namespaced_pod(
                name=self.pod_name(sandbox), namespace=self.namespace
            )
        except Exception as exc:
            if self._is_not_found(exc):
                return False, "missing"
            return False, "unknown"

        st = getattr(pod, "status", None)
        phase = str(getattr(st, "phase", "") or "").lower()
        conditions = getattr(st, "conditions", None) or []
        is_ready = any(
            getattr(c, "type", None) == "Ready" and getattr(c, "status", None) == "True"
            for c in conditions
        )
        return is_ready, phase

    def _container_health_status(self, sandbox: Sandbox) -> str | None:
        is_ready, phase = self._pod_ready_and_phase(sandbox)
        if phase == "running" and is_ready:
            return "healthy"
        if phase in {"pending", "running"}:
            return "starting"
        return None

    def _probe_health_once(
        self, sandbox: Sandbox, http: Any, url: str
    ) -> tuple[bool, str | None]:
        # When manager runs out-of-cluster without an explicit external node IP,
        # rely on Kubelet's HTTP /healthz:8080 readinessProbe condition on the Pod.
        if not self.settings.k8s_in_cluster and not (self.settings.k8s_public_host or "").strip():
            health = self._container_health_status(sandbox)
            if health == "healthy":
                return True, None
            return False, f"pod readiness={health or 'pending'}"
        return super()._probe_health_once(sandbox, http, url)

    def status(self, sandbox: Sandbox) -> str:
        name = self.workload_name(sandbox)
        try:
            sts = self.apps_v1.read_namespaced_stateful_set(
                name=name, namespace=self.namespace
            )
        except Exception as exc:
            if self._is_not_found(exc):
                return "missing"
            return "unknown"

        spec_replicas = getattr(getattr(sts, "spec", None), "replicas", 1)
        if spec_replicas is not None and int(spec_replicas) == 0:
            return "stopped"

        is_ready, phase = self._pod_ready_and_phase(sandbox)
        if phase == "running":
            return "running"
        if phase in {"pending", "missing"}:
            return "starting"
        if phase in {"succeeded", "failed"}:
            return "stopped"
        return "unknown"

    def logs(self, sandbox: Sandbox, tail: int = 200) -> str:
        self.get(sandbox)
        try:
            raw = self.core_v1.read_namespaced_pod_log(
                name=self.pod_name(sandbox),
                namespace=self.namespace,
                container="sandbox",
                tail_lines=tail,
                timestamps=True,
            )
        except Exception as exc:
            if self._is_not_found(exc):
                return ""
            raise SandboxRuntimeError(f"failed to read pod logs for {sandbox.slug}: {exc}") from exc
        if isinstance(raw, bytes):
            text = raw.decode("utf-8", errors="replace")
        else:
            text = str(raw or "")
        return strip_ansi(text)

    @staticmethod
    def _wrap_command(
        cmd: list[str],
        *,
        user: str = "root",
        environment: dict[str, str] | None = None,
    ) -> list[str]:
        inner = list(cmd)
        if environment:
            env_pairs = [f"{k}={v}" for k, v in environment.items()]
            inner = ["env", *env_pairs, *inner]
        if user and user != "root":
            quoted = " ".join(shlex.quote(part) for part in inner)
            return ["su", "-s", "/bin/sh", user, "-c", quoted]
        return inner

    def _get_stream_fn(self):
        try:
            from kubernetes.stream import stream as k8s_stream

            return k8s_stream
        except ImportError as exc:
            raise SandboxRuntimeError("kubernetes.stream is required for pod exec") from exc

    def exec_command(
        self,
        sandbox: Sandbox,
        cmd: list[str],
        *,
        user: str = "root",
        environment: dict[str, str] | None = None,
    ) -> tuple[int, bytes]:
        wrapped = self._wrap_command(cmd, user=user, environment=environment)
        k8s_stream = self._get_stream_fn()
        try:
            ws_client = k8s_stream(
                self.core_v1.connect_get_namespaced_pod_exec,
                self.pod_name(sandbox),
                self.namespace,
                container="sandbox",
                command=wrapped,
                stderr=True,
                stdin=False,
                stdout=True,
                tty=False,
                _preload_content=False,
            )
            chunks: list[bytes] = []
            while ws_client.is_open():
                ws_client.update(timeout=5)
                if ws_client.peek_stdout():
                    out = ws_client.read_stdout()
                    chunks.append(out.encode("utf-8") if isinstance(out, str) else bytes(out))
                if ws_client.peek_stderr():
                    err = ws_client.read_stderr()
                    chunks.append(err.encode("utf-8") if isinstance(err, str) else bytes(err))
            rc = getattr(ws_client, "returncode", 0)
            ws_client.close()
            return int(rc or 0), b"".join(chunks)
        except Exception as exc:
            raise SandboxRuntimeError(f"kubernetes pod exec failed for {sandbox.slug}: {exc}") from exc

    def stats(self, sandbox: Sandbox) -> dict[str, float | int | str | None]:
        """Query Kubernetes Pod metrics (metrics.k8s.io) with cgroup exec fallback."""
        mem_limit = parse_memory_to_bytes(
            sandbox.memory_limit, default=self.settings.sandbox_memory
        )
        mem_usage = 0
        cpu_percent = 0.0
        got_metrics_api = False

        try:
            metric = self.custom_objects.get_namespaced_custom_object(
                group="metrics.k8s.io",
                version="v1beta1",
                namespace=self.namespace,
                plural="pods",
                name=self.pod_name(sandbox),
            )
            containers = (metric or {}).get("containers") or []
            if containers:
                usage = containers[0].get("usage") or {}
                cores_used = _parse_k8s_cpu_to_cores(usage.get("cpu"))
                cpu_percent = round(cores_used * 100.0, 2)
                mem_usage = _parse_k8s_memory_quantity(usage.get("memory"))
                got_metrics_api = True
        except Exception:
            got_metrics_api = False

        if not got_metrics_api:
            try:
                ec, out = self.exec_command(
                    sandbox,
                    [
                        "sh",
                        "-c",
                        "cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null | head -n 1",
                    ],
                    user="root",
                )
                if ec == 0 and out:
                    raw_mem = out.decode("utf-8", errors="replace").strip()
                    if raw_mem.isdigit():
                        mem_usage = int(raw_mem)
            except Exception:
                pass

        disk = self.workspace_disk_usage(sandbox)
        return {
            "cpu_percent": cpu_percent,
            "memory_usage_bytes": mem_usage,
            "memory_limit_bytes": mem_limit,
            "memory_usage_mb": round(mem_usage / (1024 * 1024), 1),
            "memory_limit_mb": round(mem_limit / (1024 * 1024), 1),
            **disk,
        }

    def export_workspace_tar(self, sandbox: Sandbox, exclude_caches: bool = False):
        """Stream a tar archive of /home/workspace from the Kubernetes sandbox pod (base64-framed over WSClient)."""
        if self.status(sandbox) != "running":
            raise SandboxRuntimeError(
                f"sandbox {sandbox.slug} must be running in Kubernetes to export workspace backup"
            )
        tar_parts = ["tar"]
        if exclude_caches:
            tar_parts.extend(TAR_CACHE_EXCLUDES)
        tar_parts.extend(["-cf", "-", "-C", "/home", "workspace"])
        tar_shell = " ".join(shlex.quote(p) for p in tar_parts) + " | base64"

        k8s_stream = self._get_stream_fn()
        ws_client = k8s_stream(
            self.core_v1.connect_get_namespaced_pod_exec,
            self.pod_name(sandbox),
            self.namespace,
            container="sandbox",
            command=["sh", "-c", tar_shell],
            stderr=True,
            stdin=False,
            stdout=True,
            tty=False,
            _preload_content=False,
        )

        def _tar_chunks():
            carry = ""
            try:
                while ws_client.is_open():
                    ws_client.update(timeout=5)
                    if ws_client.peek_stdout():
                        raw = ws_client.read_stdout()
                        if raw:
                            text = (
                                raw.decode("ascii", errors="ignore")
                                if isinstance(raw, bytes)
                                else str(raw)
                            )
                            cleaned = carry + "".join(text.split())
                            aligned_len = (len(cleaned) // 4) * 4
                            if aligned_len > 0:
                                yield base64.b64decode(cleaned[:aligned_len])
                            carry = cleaned[aligned_len:]
                    if ws_client.peek_stderr():
                        ws_client.read_stderr()
                if carry:
                    padded = carry + ("=" * ((4 - len(carry) % 4) % 4))
                    yield base64.b64decode(padded)
            finally:
                ws_client.close()

        return _tar_chunks()

    def _stream_tar_into_pod(self, sandbox: Sandbox, tar_bytes: bytes) -> None:
        k8s_stream = self._get_stream_fn()
        ws_client = k8s_stream(
            self.core_v1.connect_get_namespaced_pod_exec,
            self.pod_name(sandbox),
            self.namespace,
            container="sandbox",
            command=["sh", "-c", "base64 -d | tar -xf - -C /home/workspace"],
            stderr=True,
            stdin=True,
            stdout=True,
            tty=False,
            _preload_content=False,
        )
        try:
            encoded = base64.b64encode(tar_bytes).decode("ascii")
            chunk_size = 32 * 1024
            for offset in range(0, len(encoded), chunk_size):
                ws_client.write_stdin(encoded[offset : offset + chunk_size])
            ws_client.write_stdin("\n")
            ws_client.update(timeout=5)
            ws_client.close()
        except Exception as exc:
            ws_client.close()
            raise SandboxRuntimeError(f"failed to stream tar into pod: {exc}") from exc

    def restore_workspace_tar(
        self,
        sandbox: Sandbox,
        archive_fileobj,
        mode: str = "merge",
    ) -> dict[str, int | bool]:
        if mode not in {"merge", "clean"}:
            raise SandboxRuntimeError(f"unsupported restore mode: {mode}")
        if self.status(sandbox) != "running":
            raise SandboxRuntimeError(
                f"sandbox {sandbox.slug} must be running in Kubernetes to restore workspace backup"
            )

        spooled, restored_entries = self._prepare_sanitized_restore_tar(archive_fileobj)
        try:
            self.exec_command(sandbox, ["supervisorctl", "stop", "dsh"], user="root")
            if mode == "clean":
                self.exec_command(
                    sandbox,
                    [
                        "find",
                        "/home/workspace",
                        "-mindepth",
                        "1",
                        "-maxdepth",
                        "1",
                        "!",
                        "-name",
                        ".dsh-sandbox",
                        "-exec",
                        "rm",
                        "-rf",
                        "{}",
                        "+",
                    ],
                    user="root",
                )
            spooled.seek(0)
            self._stream_tar_into_pod(sandbox, spooled.read())
            self.exec_command(
                sandbox,
                ["chown", "-R", "workspace:workspace", "/home/workspace"],
                user="root",
            )
            self.exec_command(sandbox, ["supervisorctl", "start", "dsh"], user="root")
            self.wait_healthy(sandbox)
        finally:
            spooled.close()

        return {"restored_entries": restored_entries, "restarted_dsh": True}

    def remove(self, sandbox: Sandbox, purge_volume: bool = False) -> None:
        self._delete_traefik_ingress_route(sandbox, include_middleware=True)

        for delete_call in (
            lambda: self.apps_v1.delete_namespaced_stateful_set(
                name=self.workload_name(sandbox), namespace=self.namespace
            ),
            lambda: self.core_v1.delete_namespaced_service(
                name=self.service_name(sandbox), namespace=self.namespace
            ),
            lambda: self.core_v1.delete_namespaced_secret(
                name=self.secret_name(sandbox), namespace=self.namespace
            ),
            lambda: self.core_v1.delete_namespaced_config_map(
                name=self.ca_configmap_name(sandbox), namespace=self.namespace
            ),
        ):
            try:
                delete_call()
            except Exception as exc:
                if not self._is_not_found(exc):
                    raise SandboxRuntimeError(str(exc)) from exc

        if purge_volume:
            try:
                self.core_v1.delete_namespaced_persistent_volume_claim(
                    name=self.pvc_name(sandbox), namespace=self.namespace
                )
            except Exception as exc:
                if not self._is_not_found(exc):
                    raise SandboxRuntimeError(
                        f"workload removed but PVC cleanup failed: {exc}"
                    ) from exc
