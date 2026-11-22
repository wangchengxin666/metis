from __future__ import annotations

import asyncio
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.models import OidcProvider
from app.oidc import (
    OidcClientRegistry,
    is_email_domain_allowed,
    probe_oidc_discovery,
    rewrite_split_horizon_url,
)
from app.schemas import (
    LlmProfileCreate,
    OidcProviderCreate,
    SandboxCreate,
    SandboxPatch,
    TemplateCreate,
    _normalize_memory,
)
from app.security import (
    _fernet,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    verify_password,
)


def test_settings_derived_urls():
    s_local = Settings(
        _env_file=None,
        manager_public_url="http://localhost:9000/",
        manager_internal_url="",
        dsh_network="dsh-manager",
    )
    assert s_local.manager_base_url == "http://localhost:9000"
    assert s_local.public_host_header == "localhost:9000"
    assert s_local.sandbox_url("alice") == "http://localhost:9000/s/alice/"
    assert s_local.sandbox_reachable_manager_url == "http://localhost:9000"
    assert s_local.plugin_index_url == "http://localhost:9000/plugins/index.json"

    s_internal = Settings(
        _env_file=None,
        manager_public_url="https://sandbox.example.com",
        manager_internal_url="http://dsh-manager:9000/",
    )
    assert s_internal.sandbox_reachable_manager_url == "http://dsh-manager:9000"

    s_remote = Settings(
        _env_file=None,
        manager_public_url="https://sandbox.example.com",
        manager_internal_url="",
    )
    assert s_remote.sandbox_reachable_manager_url == "https://sandbox.example.com"


def test_encrypt_decrypt_roundtrip_and_invalid_token(monkeypatch):
    monkeypatch.setattr(
        "app.security.get_settings",
        lambda: Settings(_env_file=None, secret_key="unit-test-secret-alpha-1234567890"),
    )
    _fernet.cache_clear()
    try:
        empty_cipher = encrypt_secret("")
        assert decrypt_secret(empty_cipher) == ""

        cipher = encrypt_secret("sk-super-secret-value")
        assert cipher != "sk-super-secret-value"
        assert decrypt_secret(cipher) == "sk-super-secret-value"

        with pytest.raises(ValueError, match="cannot decrypt secret"):
            decrypt_secret("not-a-valid-fernet-token")

        # Rotating secret key invalidates decryption of old ciphertext.
        monkeypatch.setattr(
            "app.security.get_settings",
            lambda: Settings(_env_file=None, secret_key="different-secret-key-beta-123456"),
        )
        _fernet.cache_clear()
        with pytest.raises(ValueError, match="cannot decrypt secret"):
            decrypt_secret(cipher)
    finally:
        _fernet.cache_clear()


def test_password_hashing_and_verification():
    encoded = hash_password("CorrectHorseBatteryStaple!")
    assert encoded.startswith("scrypt$")
    assert verify_password("CorrectHorseBatteryStaple!", encoded) is True
    assert verify_password("WrongPassword", encoded) is False
    assert verify_password("any", None) is False
    assert verify_password("any", "not-a-valid-hash") is False
    assert verify_password("any", "bcrypt$foo$bar") is False


def test_schema_memory_and_password_validators():
    assert _normalize_memory(None) is None
    assert _normalize_memory(" 4G ") == "4g"
    assert _normalize_memory("512m") == "512m"
    assert _normalize_memory("2048m") == "2048m"

    with pytest.raises(ValueError):
        _normalize_memory("512")
    with pytest.raises(ValueError):
        _normalize_memory("abc")

    sbx = SandboxCreate(
        email="User@Example.COM",
        display_name=" Alice ",
        initial_password="  strongpass123 ",
        memory_limit="2G",
    )
    assert sbx.email == "User@example.com"
    assert sbx.initial_password == "strongpass123"
    assert sbx.memory_limit == "2g"

    with pytest.raises(ValidationError):
        SandboxCreate(email="user@example.com", initial_password="short")

    with pytest.raises(ValidationError):
        TemplateCreate(key="BAD KEY!", name="Invalid")

    patch = SandboxPatch(cpu_limit=4.0, memory_limit="8G")
    assert patch.memory_limit == "8g"

    llm = LlmProfileCreate(
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        model="gpt-4o",
        api_key="sk-123",
    )
    assert llm.name == "OpenAI"


def test_oidc_provider_schema_and_helpers():
    created = OidcProviderCreate(
        slug="corp-sso",
        name=" Corp SSO ",
        issuer_url="https://idp.corp.com/realms/main",
        client_id="dsh-web",
        client_secret="top-secret",
        allowed_domains=" @Corp.COM , example.org ; corp.com ",
    )
    assert created.slug == "corp-sso"
    assert created.name == "Corp SSO"
    assert created.allowed_domains == "corp.com,example.org"

    # Reserved slugs rejected
    for reserved in ("start", "callback"):
        with pytest.raises(ValidationError):
            OidcProviderCreate(
                slug=reserved,
                name="Bad",
                issuer_url="https://idp.example.com",
                client_id="cid",
            )

    # Requires at least one of issuer_url or discovery_url
    with pytest.raises(ValidationError):
        OidcProviderCreate(slug="missing-url", name="Bad", client_id="cid")

    # Invalid scheme or domain rejected
    with pytest.raises(ValidationError):
        OidcProviderCreate(
            slug="bad-scheme",
            name="Bad",
            issuer_url="ftp://idp.example.com",
            client_id="cid",
        )
    with pytest.raises(ValidationError):
        OidcProviderCreate(
            slug="bad-domain",
            name="Bad",
            issuer_url="https://idp.example.com",
            client_id="cid",
            allowed_domains="not a valid domain!",
        )

    assert is_email_domain_allowed("alice@corp.com", None) is True
    assert is_email_domain_allowed("alice@corp.com", "corp.com,example.org") is True
    assert is_email_domain_allowed("alice@other.io", "corp.com,example.org") is False
    assert is_email_domain_allowed("not-an-email", "corp.com") is False

    rewritten = rewrite_split_horizon_url(
        "http://dsh-keycloak:8080/realms/main/protocol/openid-connect/logout",
        "http://dsh-keycloak:8080/realms/main/.well-known/openid-configuration",
        "https://sso.example.com/realms/main",
    )
    assert rewritten == "https://sso.example.com/realms/main/protocol/openid-connect/logout"
    unchanged = rewrite_split_horizon_url(
        "https://idp.example.com/logout",
        "http://dsh-keycloak:8080/.well-known/openid-configuration",
        "https://sso.example.com",
    )
    assert unchanged == "https://idp.example.com/logout"


def test_oidc_client_registry_caching_and_discovery_probe(monkeypatch):
    registry = OidcClientRegistry()
    secret_ct = encrypt_secret("real-client-secret")
    provider = OidcProvider(
        id="prov-1",
        slug="corp-kc",
        name="Corp KC",
        enabled=True,
        issuer_url="https://idp.corp.com/realms/main",
        discovery_url=None,
        client_id="dsh-web",
        client_secret_ciphertext=secret_ct,
        scope="openid profile email",
        email_claim="email",
    )
    c1 = registry.get_client(provider)
    c2 = registry.get_client(provider)
    assert c1 is c2
    assert c1.client_id == "dsh-web"
    assert c1.client_secret == "real-client-secret"

    # Changing client_id invalidates cache automatically via fingerprint
    provider.client_id = "dsh-web-v2"
    c3 = registry.get_client(provider)
    assert c3 is not c1
    assert c3.client_id == "dsh-web-v2"

    # Explicit invalidate forces recreation
    registry.invalidate("corp-kc")
    c4 = registry.get_client(provider)
    assert c4 is not c3

    # Test probe_oidc_discovery with mocked httpx.AsyncClient
    import app.oidc as oidc_mod

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url: str):
            if "good" in url:
                return _FakeResp(
                    200,
                    {
                        "issuer": "https://good.idp",
                        "authorization_endpoint": "https://good.idp/auth",
                        "token_endpoint": "https://good.idp/token",
                        "end_session_endpoint": "https://good.idp/logout",
                    },
                )
            return _FakeResp(404, {})

    monkeypatch.setattr(oidc_mod.httpx, "AsyncClient", _FakeAsyncClient)
    ok = asyncio.run(probe_oidc_discovery("https://good.idp"))
    assert ok["ok"] is True
    assert ok["supports_logout"] is True
    assert ok["discovery_url"] == "https://good.idp/.well-known/openid-configuration"

    fail = asyncio.run(probe_oidc_discovery("https://missing.idp"))
    assert fail["ok"] is False
    assert "404" in fail["detail"]
