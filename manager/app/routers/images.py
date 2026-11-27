"""Container registry credential CRUD, login verification, and Digital Employee Image Factory routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import _manager_error, require_admin_api, resolve_docker, session_email, settings
from ..schemas import (
    ContainerRegistryCreate,
    ContainerRegistryOut,
    ContainerRegistryTestOut,
    ContainerRegistryTestRequest,
    ContainerRegistryUpdate,
    ImageBaseBuildRequest,
    ImageBuildJobOut,
    ImagePruneOut,
    ImagePullRequest,
    ImagePushRequest,
    ImageVariantBuildRequest,
)
from ..services.images import (
    create_registry,
    delete_registry,
    get_image_job,
    image_job_to_out_dict,
    list_image_jobs,
    list_registries,
    prune_unused_images,
    registry_to_out_dict,
    start_base_build_job,
    start_pull_job,
    start_push_job,
    start_variant_build_job,
    test_registry_connection,
    update_registry,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Container Registries (Encrypted Login & K8s PullSecret Sync)
# ---------------------------------------------------------------------------


@router.get("/api/registries", response_model=list[ContainerRegistryOut])
def api_list_registries(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return [ContainerRegistryOut(**registry_to_out_dict(r)) for r in list_registries(db)]


@router.post("/api/registries", response_model=ContainerRegistryOut, status_code=201)
def api_create_registry(
    payload: ContainerRegistryCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        reg = create_registry(
            db,
            resolve_docker(),
            name=payload.name,
            registry_host=payload.registry_host,
            username=payload.username,
            password=payload.password,
            tls_verify=payload.tls_verify,
            is_default=payload.is_default,
            actor=session_email(request),
        )
        return ContainerRegistryOut(**registry_to_out_dict(reg))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.patch("/api/registries/{registry_id}", response_model=ContainerRegistryOut)
def api_update_registry(
    registry_id: str,
    payload: ContainerRegistryUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        reg = update_registry(
            db,
            resolve_docker(),
            registry_id,
            name=payload.name,
            registry_host=payload.registry_host,
            username=payload.username,
            password=payload.password,
            tls_verify=payload.tls_verify,
            is_default=payload.is_default,
            actor=session_email(request),
        )
        return ContainerRegistryOut(**registry_to_out_dict(reg))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.delete("/api/registries/{registry_id}")
def api_delete_registry(
    registry_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        delete_registry(db, resolve_docker(), registry_id, actor=session_email(request))
        return {"deleted": True, "id": registry_id}
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/registries/test", response_model=ContainerRegistryTestOut)
def api_test_registry(
    payload: ContainerRegistryTestRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return test_registry_connection(
            db,
            resolve_docker(),
            registry_id=payload.registry_id,
            registry_host=payload.registry_host,
            username=payload.username,
            password=payload.password,
            tls_verify=payload.tls_verify,
        )
    except Exception as exc:
        raise _manager_error(exc) from exc


# ---------------------------------------------------------------------------
# Digital Employee Image Factory
# ---------------------------------------------------------------------------


@router.get("/api/images")
def api_list_images(_: None = Depends(require_admin_api)):
    runtime = resolve_docker()
    return {
        "runtime": runtime.runtime_name,
        "images": runtime.list_local_images(),
    }


@router.get("/api/images/jobs", response_model=list[ImageBuildJobOut])
def api_list_image_jobs(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    return [ImageBuildJobOut(**image_job_to_out_dict(j)) for j in list_image_jobs(db, limit=limit)]


@router.get("/api/images/jobs/{job_id}", response_model=ImageBuildJobOut)
def api_get_image_job(
    job_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        job = get_image_job(db, job_id)
        return ImageBuildJobOut(**image_job_to_out_dict(job))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/images/pull", response_model=ImageBuildJobOut, status_code=status.HTTP_202_ACCEPTED)
def api_pull_image(
    payload: ImagePullRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        job = start_pull_job(
            db,
            settings,
            resolve_docker(),
            image_repo=payload.image_repo,
            image_tag=payload.image_tag,
            registry_id=payload.registry_id,
            actor=session_email(request),
        )
        return ImageBuildJobOut(**image_job_to_out_dict(job))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/images/build-base", response_model=ImageBuildJobOut, status_code=status.HTTP_202_ACCEPTED)
def api_build_base_image(
    payload: ImageBaseBuildRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        job = start_base_build_job(
            db,
            settings,
            resolve_docker(),
            image_repo=payload.image_repo,
            image_tag=payload.image_tag,
            install_browser=payload.install_browser,
            network_preset=payload.network_preset,
            nocache=payload.nocache,
            push_registry_id=payload.push_registry_id,
            actor=session_email(request),
        )
        return ImageBuildJobOut(**image_job_to_out_dict(job))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/images/build-variant", response_model=ImageBuildJobOut, status_code=status.HTTP_202_ACCEPTED)
def api_build_variant_image(
    payload: ImageVariantBuildRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        job = start_variant_build_job(
            db,
            settings,
            resolve_docker(),
            image_repo=payload.image_repo,
            image_tag=payload.image_tag,
            base_image=payload.base_image,
            apt_packages=payload.apt_packages,
            pip_packages=payload.pip_packages,
            npm_packages=payload.npm_packages,
            install_ca_bundle=payload.install_ca_bundle,
            network_preset=payload.network_preset,
            nocache=payload.nocache,
            push_registry_id=payload.push_registry_id,
            bind_template_key=payload.bind_template_key,
            actor=session_email(request),
        )
        return ImageBuildJobOut(**image_job_to_out_dict(job))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/images/push", response_model=ImageBuildJobOut, status_code=status.HTTP_202_ACCEPTED)
def api_push_image(
    payload: ImagePushRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        job = start_push_job(
            db,
            settings,
            resolve_docker(),
            source_image=payload.source_image,
            target_repo=payload.target_repo,
            target_tag=payload.target_tag,
            registry_id=payload.registry_id,
            actor=session_email(request),
        )
        return ImageBuildJobOut(**image_job_to_out_dict(job))
    except Exception as exc:
        raise _manager_error(exc) from exc


@router.post("/api/images/prune", response_model=ImagePruneOut)
def api_prune_images(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_api),
):
    try:
        return prune_unused_images(db, resolve_docker(), actor=session_email(request))
    except Exception as exc:
        raise _manager_error(exc) from exc
