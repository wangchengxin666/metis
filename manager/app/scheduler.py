from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from .config import Settings
from .coordination import get_redis_client, try_acquire_lease
from .db import SessionLocal, get_database_backend
from .docker_service import DockerService, SandboxRuntimeError
from .models import PlaybookRun, Sandbox
from .services import audit, get_branding_config, get_idle_sleep_policy, utcnow
from .services.notifications import NotificationEvent, dispatch_notification_event
from .services.playbooks import process_due_scheduled_playbooks, sync_playbook_run_progress
from .services.vault import refresh_expiring_github_app_credentials
from .services.workspace_hub import refresh_sandboxes_snapshots

logger = logging.getLogger("dsh-manager.scheduler")


class BackgroundWorker:
    """Reconcile container status, periodic disk usage, runtime snapshots, notifications, and idle auto-sleep."""

    def __init__(self, settings: Settings, docker: DockerService):
        self.settings = settings
        self.docker = docker
        self._tick_count = 0

    async def run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.tick)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("background reconcile failed")
            await asyncio.sleep(self.settings.reconcile_interval_seconds)

    def tick(self) -> None:
        # In multi-worker / distributed deployments, elect a single scheduler leader per tick
        if get_redis_client(self.settings) is not None or get_database_backend() != "sqlite":
            lease_ttl = max(20.0, float(self.settings.reconcile_interval_seconds) * 1.6)
            if not try_acquire_lease("scheduler_leader", ttl_seconds=lease_ttl):
                logger.debug("Skipping background tick (standby worker)")
                return
        self._tick_count += 1
        refresh_disk_this_tick = (self._tick_count % 5) == 1
        refresh_snapshots_this_tick = (self._tick_count % 2) == 1
        now = utcnow()
        with SessionLocal() as db:
            idle_enabled, idle_minutes = get_idle_sleep_policy(db, self.settings)
            sandboxes = list(
                db.scalars(
                    select(Sandbox).where(Sandbox.deleted_at.is_(None))
                ).all()
            )
            unhealthy_sandboxes: list[tuple[Sandbox, str]] = []
            for sandbox in sandboxes:
                prev_status = sandbox.status
                try:
                    container = self.docker.get(sandbox)
                    container.reload()
                except SandboxRuntimeError:
                    sandbox.status = "missing"
                    if prev_status == "running":
                        unhealthy_sandboxes.append((sandbox, "missing"))
                    continue
                sandbox.status = container.status
                if prev_status == "running" and sandbox.status in {"exited", "dead", "missing"}:
                    unhealthy_sandboxes.append((sandbox, sandbox.status))

                if sandbox.status == "running" and (
                    refresh_disk_this_tick or sandbox.disk_usage_mb is None
                ):
                    try:
                        disk = self.docker.workspace_disk_usage(sandbox)
                        if disk.get("disk_usage_mb") is not None:
                            sandbox.disk_usage_mb = float(disk["disk_usage_mb"])
                            sandbox.disk_updated_at = now
                    except Exception:
                        pass

                if (
                    idle_enabled
                    and sandbox.status == "running"
                    and not sandbox.auto_sleep_exempt
                ):
                    last_active = sandbox.last_seen_at or sandbox.created_at
                    if last_active and (now - last_active) >= timedelta(minutes=idle_minutes):
                        try:
                            busy, _reason = self.docker.has_active_work(sandbox)
                            if not busy:
                                stopped_status = self.docker.stop(sandbox)
                                sandbox.status = stopped_status
                                audit(
                                    db,
                                    "sandbox.auto_sleep",
                                    target=sandbox.id,
                                    detail=f"slug={sandbox.slug},idle>={idle_minutes}m",
                                )
                        except Exception:
                            logger.warning("idle sleep check/stop failed for %s", sandbox.slug)
            db.commit()

            if unhealthy_sandboxes:
                try:
                    brand = get_branding_config(db)
                    brand_name = str(
                        brand.get("brand_name_zh") or brand.get("brand_name_en") or "Metis"
                    )
                    for sbx, next_status in unhealthy_sandboxes:
                        dispatch_notification_event(
                            db,
                            self.settings,
                            NotificationEvent(
                                event_type="sandbox.unhealthy",
                                title=f"数字员工 @{sbx.slug} 异常离线 ({next_status})",
                                summary=f"容器状态从 running 变为 {next_status}，请检查日志或尝试重新启动。",
                                severity="danger",
                                sandbox_id=sbx.id,
                                sandbox_slug=sbx.slug,
                                role_title=sbx.role_title,
                                project_team_name=sbx.project_team_name,
                                dedupe_key=f"sandbox.unhealthy:{sbx.id}:{now.strftime('%Y%m%d%H')}",
                            ),
                            brand_name=brand_name,
                        )
                except Exception:
                    logger.warning("unhealthy notification dispatch failed")

            if refresh_snapshots_this_tick and hasattr(self.docker, "inspect_workforce_runtime"):
                try:
                    refresh_sandboxes_snapshots(
                        db,
                        self.docker,
                        sandboxes,
                        settings=self.settings,
                        max_workers=4,
                        emit_notifications=True,
                    )
                except Exception:
                    logger.warning("periodic workforce snapshot refresh failed")

            try:
                active_runs = list(
                    db.scalars(
                        select(PlaybookRun).where(
                            PlaybookRun.status.in_(["running", "awaiting_approval"])
                        )
                    ).all()
                )
                check_runtime = bool(
                    refresh_snapshots_this_tick
                    and hasattr(self.docker, "inspect_workforce_runtime")
                )
                for run in active_runs:
                    sync_playbook_run_progress(
                        db,
                        self.settings,
                        self.docker,
                        run,
                        check_runtime=check_runtime,
                    )
            except Exception:
                logger.warning("periodic playbook sync failed")

            try:
                process_due_scheduled_playbooks(db, self.settings, self.docker)
            except Exception:
                logger.warning("scheduled playbook execution check failed")

            try:
                refresh_expiring_github_app_credentials(db, self.docker)
            except Exception:
                logger.warning("periodic GitHub App token refresh failed")
