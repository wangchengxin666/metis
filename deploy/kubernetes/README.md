# Kubernetes + PostgreSQL Deployment for DSH Dock

This directory provides production-ready Kubernetes manifests for running `dsh-manager` with **PostgreSQL** and the **Kubernetes Sandbox Runtime** (`SANDBOX_RUNTIME=kubernetes`).

## Architecture on Kubernetes

- **Control Plane (`dsh-manager`)**: Runs with a scoped `ServiceAccount` (`00-namespace-rbac.yaml`) that manages per-user sandboxes inside the `dsh-sandboxes` namespace.
- **Database (`dsh-postgres`)**: PostgreSQL 17 `StatefulSet` (`01-postgres.yaml`), or point `DATABASE_URL` to any external managed PostgreSQL / MySQL / RDS instance.
- **Per-User Sandboxes (`dsh-sbx-<slug>`)**:
  - Provisioned as a `StatefulSet` (`replicas: 1` when running, `replicas: 0` when stopped/sleeping to release 100% of cluster CPU & RAM).
  - Persistent `/home/workspace` backed by a dedicated `PersistentVolumeClaim` (`dsh-<slug>-home`).
  - Hardened with `automountServiceAccountToken: false`, `enableServiceLinks: false`, and `allowPrivilegeEscalation: false`.
- **Traefik Routing (`K8S_ROUTING_MODE`)**:
  - `traefik-http` (default, zero CRD dependencies): `dsh-gateway` (Traefik v3.7) polls `http://dsh-manager:9000/api/internal/traefik/config` for active sandboxes and falls back to `dsh-manager` for sleeping sandboxes (rendering the Auto-Wake UI).
  - `traefik-crd`: When using a cluster-wide Traefik Ingress Controller, set `K8S_ROUTING_MODE=traefik-crd` and `dsh-manager` will automatically create/remove `traefik.io/v1alpha1` `IngressRoute` and `Middleware` resources as sandboxes start and stop.

## Quick Apply

```bash
kubectl apply -f deploy/kubernetes/00-namespace-rbac.yaml
kubectl apply -f deploy/kubernetes/01-postgres.yaml
# Edit secrets in 02-manager-traefik.yaml first (SECRET_KEY, MANAGER_ADMIN_TOKEN, POSTGRES_PASSWORD)
kubectl apply -f deploy/kubernetes/02-manager-traefik.yaml
```
