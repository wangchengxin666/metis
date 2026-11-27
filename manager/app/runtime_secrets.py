"""Atomic multi-worker secret resolution & setup code file helpers for zero-config startup."""

from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path

from .config import Settings
from .security import clear_fernet_cache

_PLACEHOLDER_SECRETS = {
    "change-me-in-production",
    "replace-with-a-long-random-secret",
}
_AUTO_SECRETS = {"", "auto"}


def _secrets_file_path(settings: Settings) -> Path:
    explicit = (getattr(settings, "runtime_secrets_file", "") or "").strip()
    if explicit:
        return Path(explicit)
    if Path("/data").is_dir():
        return Path("/data/.runtime-secrets.json")
    return settings.data_dir / ".runtime-secrets.json"


def _setup_code_file_path(settings: Settings) -> Path:
    return _secrets_file_path(settings).parent / "INITIAL_SETUP_CODE.txt"


def _read_secret_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        val = str(payload.get("secret_key") or "").strip()
        if len(val) >= 32 and val not in _PLACEHOLDER_SECRETS:
            return val
    except Exception:
        return None
    return None


def resolve_runtime_secret_key(settings: Settings) -> str:
    """Resolve SECRET_KEY or atomically persist a shared multi-worker secret when set to 'auto'/empty.

    Explicit insecure placeholders such as 'change-me-in-production' are intentionally preserved
    so startup validation rejects accidental misconfiguration cleanly.
    """
    current = (settings.secret_key or "").strip()
    if current not in _AUTO_SECRETS:
        return current

    target = _secrets_file_path(settings)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = _read_secret_file(target)
    if existing:
        settings.secret_key = existing
        clear_fernet_cache()
        return existing

    lock_path = target.with_name(f"{target.name}.lock")
    deadline = time.monotonic() + 8.0
    fd: int | None = None
    while time.monotonic() < deadline:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            break
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > 30.0:
                    lock_path.unlink(missing_ok=True)
                    continue
            except Exception:
                pass
            time.sleep(0.05)

    try:
        existing = _read_secret_file(target)
        if existing:
            settings.secret_key = existing
            clear_fernet_cache()
            return existing

        generated = secrets.token_hex(32)
        tmp_path = target.with_name(f"{target.name}.{os.getpid()}.tmp")
        tmp_path.write_text(json.dumps({"secret_key": generated}, indent=2) + "\n", encoding="utf-8")
        try:
            os.chmod(tmp_path, 0o600)
        except Exception:
            pass
        os.replace(tmp_path, target)
        try:
            os.chmod(target, 0o600)
        except Exception:
            pass
        settings.secret_key = generated
        clear_fernet_cache()
        return generated
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
            try:
                lock_path.unlink(missing_ok=True)
            except Exception:
                pass


def write_initial_setup_code_file(settings: Settings, setup_code: str) -> Path | None:
    """Persist the one-time setup code with restricted permissions until onboarding finishes."""
    try:
        path = _setup_code_file_path(settings)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"# Metis Digital Workforce Cloud - One-Time Initial Setup Code\n"
            f"# Enter this code at {settings.manager_base_url}/setup (automatically deleted after setup).\n"
            f"{setup_code}\n",
            encoding="utf-8",
        )
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
        return path
    except Exception:
        return None


def remove_initial_setup_code_file(settings: Settings) -> None:
    """Delete INITIAL_SETUP_CODE.txt cleanly once setup completes."""
    try:
        _setup_code_file_path(settings).unlink(missing_ok=True)
    except Exception:
        pass
