from __future__ import annotations

import pytest

from app.config import Settings
from app.docker_service import SandboxRuntimeError
from app.models import AuditLog, SandboxTemplate
from app.schemas import OidcProviderCreate, OidcProviderUpdate, TemplateCreate, TemplateUpdate
from app.security import decrypt_secret
from app.services import (
    Conflict,
    NotFoundError,
    add_platform_admin,
    create_llm_profile,
    create_oidc_provider,
    create_sandbox,
    create_template,
    deactivate_platform_admin,
    delete_oidc_provider,
    delete_sandbox,
    delete_template,
    ensure_bootstrap_admin,
    ensure_bootstrap_oidc_provider,
    ensure_default_templates,
    get_allow_local_user_login,
    get_or_create_user,
    list_oidc_providers,
    list_templates,
    restart_sandbox,
    set_allow_local_user_login,
    start_sandbox,
    stop_sandbox,
    unique_slug,
    update_oidc_provider,
    update_sandbox_limits,
    update_template,
    upgrade_sandbox,
)


def test_slug_and_admin_lifecycle(db_session):
    ensure_bootstrap_admin(db_session, "admin@example.com")
    second = add_platform_admin(db_session, "ops@example.com", "Ops")
    assert second.active is True
    deactivated = deactivate_platform_admin(db_session, "ops@example.com")
    assert deactivated.active is False

    with pytest.raises(NotFoundError):
        deactivate_platform_admin(db_session, "missing@example.com")

    # Slug deduplication
    assert unique_slug(db_session, "alice@example.com", None) == "alice"
    u = get_or_create_user(db_session, "alice@example.com", "Alice")
    assert u.email == "alice@example.com"
    assert u.display_name == "Alice"


def test_default_templates_migration_and_crud(db_session):
    settings = Settings(_env_file=None, sandbox_auto_install_plugins="file-manager")
    # Seed obsolete built-in templates and ensure agent-os is created cleanly
    db_session.query(SandboxTemplate).delete()
    db_session.add_all(
        [
            SandboxTemplate(key="fullstack-web", name="Old Web", is_builtin=True),
            SandboxTemplate(key="python-data", name="Old Py", is_builtin=True),
        ]
    )
    db_session.commit()

    ensure_default_templates(db_session, settings)
    templates = list_templates(db_session)
    keys = [t.key for t in templates]
    assert "agent-os" in keys
    assert "fullstack-web" not in keys
    assert "python-data" not in keys
    agent_os = next(t for t in templates if t.key == "agent-os")
    assert agent_os.init_script is None

    # Legacy untouched built-in agent-os script should be cleared automatically on startup
    agent_os.init_script = "#!/usr/bin/env bash\nmkdir -p /home/workspace/projects\n"
    db_session.commit()
    ensure_default_templates(db_session, settings)
    db_session.refresh(agent_os)
    assert agent_os.init_script is None

    # Custom script on agent-os is preserved
    agent_os.init_script = "#!/usr/bin/env bash\necho custom\n"
    db_session.commit()
    ensure_default_templates(db_session, settings)
    db_session.refresh(agent_os)
    assert agent_os.init_script == "#!/usr/bin/env bash\necho custom\n"

    # Untouched legacy default plugin list ("file-manager") upgrades to full built-in bundle
    agent_os.auto_install_plugins = "file-manager"
    db_session.commit()
    ensure_default_templates(db_session, Settings(_env_file=None, sandbox_auto_install_plugins=""))
    db_session.refresh(agent_os)
    assert agent_os.auto_install_plugins == "file-manager,workspace-user,custom-theme,sandbox-mesh,sandbox-memory"

    # Custom plugin override is preserved on subsequent restarts
    agent_os.auto_install_plugins = "file-manager,custom-only"
    db_session.commit()
    ensure_default_templates(db_session, Settings(_env_file=None, sandbox_auto_install_plugins=""))
    db_session.refresh(agent_os)
    assert agent_os.auto_install_plugins == "file-manager,custom-only"

    # Reset back to empty default for subsequent assertions
    agent_os.init_script = None
    db_session.commit()

    custom = create_template(
        db_session,
        TemplateCreate(
            key="rust-dev",
            name="Rust Dev",
            default_cpu_limit=4.0,
            default_memory_limit="8g",
            init_script="   \n",
        ),
    )
    assert custom.init_script is None
    updated = update_template(db_session, custom.id, TemplateUpdate(name="Rust Workstation", default_cpu_limit=6.0))
    assert updated.name == "Rust Workstation"
    assert updated.default_cpu_limit == 6.0

    with pytest.raises(Conflict):
        create_template(db_session, TemplateCreate(key="rust-dev", name="Dup"))

    delete_template(db_session, custom.id)
    assert all(t.id != custom.id for t in list_templates(db_session))


def test_sandbox_lifecycle_rollback_and_upgrade(db_session, fake_docker):
    settings = Settings(_env_file=None, sandbox_auto_install_plugins="file-manager")
    llm = create_llm_profile(db_session, "GPT", "https://api.openai.com/v1", "gpt-4o", "enc-key")

    sbx = create_sandbox(
        db_session,
        settings,
        fake_docker,  # type: ignore[arg-type]
        email="alice@example.com",
        slug=None,
        display_name="Alice",
        image_tag="latest",
        cpu_limit=3.0,
        memory_limit="6g",
        llm_profile_id=llm.id,
        template="agent-os",
    )
    assert sbx.slug == "alice"
    assert sbx.status == "running"
    assert sbx.init_script is None
    assert sbx.container_id == "cid-alice"
    assert ("create", "alice") in fake_docker.calls
    assert ("wait_healthy", "alice") in fake_docker.calls

    # Duplicate slug rejected
    with pytest.raises(Conflict):
        create_sandbox(
            db_session,
            settings,
            fake_docker,  # type: ignore[arg-type]
            email="alice@example.com",
            slug="alice",
            display_name=None,
            image_tag=None,
        )

    assert stop_sandbox(db_session, fake_docker, sbx.id).status == "stopped"  # type: ignore[arg-type]
    assert start_sandbox(db_session, fake_docker, sbx.id).status == "running"  # type: ignore[arg-type]
    assert restart_sandbox(db_session, fake_docker, sbx.id).status == "running"  # type: ignore[arg-type]

    patched = update_sandbox_limits(
        db_session,
        fake_docker,  # type: ignore[arg-type]
        sbx.id,
        4.0,
        "8g",
    )
    assert patched.cpu_limit == 4.0
    assert patched.memory_limit == "8g"

    upgraded = upgrade_sandbox(
        db_session,
        fake_docker,  # type: ignore[arg-type]
        sbx.id,
        image_tag="v2",
    )
    assert upgraded.image_tag == "v2"

    deleted = delete_sandbox(
        db_session,
        fake_docker,  # type: ignore[arg-type]
        sbx.id,
        purge_volume=True,
    )
    assert deleted.status == "deleted"
    assert deleted.deleted_at is not None
    assert ("remove", ("alice", True)) in fake_docker.calls

    # Creating sandbox cleans up container & DB record if wait_healthy fails
    fake_docker.fail_on_health = SandboxRuntimeError("timeout")
    with pytest.raises(SandboxRuntimeError):
        create_sandbox(
            db_session,
            settings,
            fake_docker,  # type: ignore[arg-type]
            email="bob@example.com",
            slug=None,
            display_name=None,
            image_tag=None,
        )
    assert "bob" not in fake_docker.containers
    assert db_session.query(AuditLog).count() >= 5

    with pytest.raises(NotFoundError):
        start_sandbox(db_session, fake_docker, "missing-id")  # type: ignore[arg-type]


def test_oidc_provider_crud_and_env_bootstrap(db_session):
    token_settings = Settings(_env_file=None, manager_auth_mode="token")
    oidc_settings = Settings(
        _env_file=None,
        manager_auth_mode="oidc",
        oidc_issuer_url="https://idp.example.com/realms/main",
        oidc_client_id="legacy-client",
        oidc_client_secret="legacy-secret",
        oidc_email_claim="preferred_username",
    )

    # Defaults depend on mode until explicitly saved in DB
    assert get_allow_local_user_login(db_session, token_settings) is True
    assert get_allow_local_user_login(db_session, oidc_settings) is False
    assert set_allow_local_user_login(db_session, True, actor="admin@example.com") is True
    assert get_allow_local_user_login(db_session, oidc_settings) is True

    # Legacy env OIDC vars bootstrap once into DB with encrypted secret
    seeded = ensure_bootstrap_oidc_provider(db_session, oidc_settings)
    assert seeded is not None
    assert seeded.slug == "default"
    assert seeded.client_id == "legacy-client"
    assert seeded.has_client_secret is True
    assert seeded.client_secret_ciphertext != "legacy-secret"
    assert decrypt_secret(seeded.client_secret_ciphertext) == "legacy-secret"
    assert seeded.email_claim == "preferred_username"

    # Deleting the bootstrapped provider must NOT cause it to resurrect on next startup
    delete_oidc_provider(db_session, seeded, actor="admin@example.com")
    assert list_oidc_providers(db_session) == []
    assert ensure_bootstrap_oidc_provider(db_session, oidc_settings) is None
    assert list_oidc_providers(db_session) == []

    # Manual CRUD + duplicate slug + secret rotation / clear + validation
    p1 = create_oidc_provider(
        db_session,
        OidcProviderCreate(
            slug="keycloak",
            name="Keycloak",
            issuer_url="https://kc.example.com/realms/corp",
            client_id="kc-web",
            client_secret="sec-1",
            sort_order=20,
        ),
        actor="admin@example.com",
    )
    p2 = create_oidc_provider(
        db_session,
        OidcProviderCreate(
            slug="okta",
            name="Okta",
            issuer_url="https://okta.example.com",
            client_id="okta-web",
            sort_order=10,
        ),
        actor="admin@example.com",
    )
    assert [p.slug for p in list_oidc_providers(db_session)] == ["okta", "keycloak"]

    with pytest.raises(Conflict):
        create_oidc_provider(
            db_session,
            OidcProviderCreate(
                slug="keycloak",
                name="Duplicate",
                issuer_url="https://kc.example.com",
                client_id="dup",
            ),
        )

    updated = update_oidc_provider(
        db_session,
        p1,
        OidcProviderUpdate(name="Corp Keycloak", client_secret="sec-2", enabled=False),
        actor="admin@example.com",
    )
    assert updated.name == "Corp Keycloak"
    assert updated.enabled is False
    assert decrypt_secret(updated.client_secret_ciphertext) == "sec-2"
    assert [p.slug for p in list_oidc_providers(db_session, enabled_only=True)] == ["okta"]

    cleared = update_oidc_provider(
        db_session,
        updated,
        OidcProviderUpdate(clear_client_secret=True),
    )
    assert cleared.has_client_secret is False

    with pytest.raises(ValueError):
        update_oidc_provider(
            db_session,
            p2,
            OidcProviderUpdate(issuer_url="", discovery_url=None),
        )
