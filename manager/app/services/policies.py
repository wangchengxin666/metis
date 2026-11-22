from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import LlmProfile, OidcProvider, PlatformSetting, Sandbox
from ..schemas import OidcProviderCreate, OidcProviderUpdate
from ..security import encrypt_secret
from .common import Conflict, audit, utcnow


DEFAULT_BRAND_NAME_ZH = "Metis"
DEFAULT_BRAND_NAME_EN = "Metis"
DEFAULT_BRAND_THEME: dict[str, str] = {
    "mode": "dark",
    "primary": "#6366f1",
    "accent": "#06b6d4",
    "radius": "rounded",
    "font_scale": "comfortable",
    "layout_width": "wide",
}
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_VALID_THEME_MODES = {"dark", "light", "slate"}
_VALID_RADII = {"sharp", "md", "rounded", "pill"}
_VALID_FONT_SCALES = {"normal", "comfortable", "large"}
_VALID_LAYOUT_WIDTHS = {"standard", "wide", "full"}


def sanitize_brand_theme(raw: dict[str, str] | None) -> dict[str, str]:
    """Validate and normalize admin-configured brand design tokens."""
    merged = dict(DEFAULT_BRAND_THEME)
    if not raw or not isinstance(raw, dict):
        return merged
    mode = str(raw.get("mode") or "").strip().lower()
    if mode in _VALID_THEME_MODES:
        merged["mode"] = mode
    for key in ("primary", "accent"):
        val = str(raw.get(key) or "").strip()
        if val:
            if not _HEX_COLOR_RE.fullmatch(val):
                raise ValueError(f"无效的颜色值 {key}: {val}（需为 #RRGGBB 格式）")
            merged[key] = val.lower()
    radius = str(raw.get("radius") or "").strip().lower()
    if radius in _VALID_RADII:
        merged["radius"] = radius
    font_scale = str(raw.get("font_scale") or "").strip().lower()
    if font_scale in _VALID_FONT_SCALES:
        merged["font_scale"] = font_scale
    layout_width = str(raw.get("layout_width") or "").strip().lower()
    if layout_width in _VALID_LAYOUT_WIDTHS:
        merged["layout_width"] = layout_width
    return merged
DEFAULT_BRAND_LOGO_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">'
    "<defs>"
    '<linearGradient id="metis-bg" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">'
    '<stop offset="0%" stop-color="#6366f1"/>'
    '<stop offset="55%" stop-color="#7c3aed"/>'
    '<stop offset="100%" stop-color="#06b6d4"/>'
    "</linearGradient>"
    "</defs>"
    '<rect width="64" height="64" rx="16" fill="url(#metis-bg)"/>'
    '<path d="M16 45V21l16 14 16-14v24" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    '<path d="M32 13l2.6 5.4 5.4 2.6-5.4 2.6L32 29l-2.6-5.4L24 21l5.4-2.6L32 13z" fill="#e0f2fe"/>'
    "</svg>"
)

_FORBIDDEN_SVG_TAGS = {
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "applet",
    "meta",
    "link",
    "base",
    "audio",
    "video",
}
_SAFE_FAVICON_DATA_URI_RE = re.compile(
    r"^data:image/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|webp|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$",
    re.IGNORECASE,
)
_SAFE_FAVICON_URL_RE = re.compile(r"^(https?://[^\s<>\"']+|/[^\s<>\"']*)$", re.IGNORECASE)
_DANGEROUS_URI_RE = re.compile(r"^\s*(javascript|vbscript|data\s*:\s*text/html)", re.IGNORECASE)


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1].lower()
    return tag.lower()


def sanitize_brand_svg(raw: str | None) -> str:
    """Validate and sanitize a custom inline SVG string against XSS payloads."""
    if raw is None:
        return ""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    if len(cleaned) > 32768:
        raise ValueError("SVG 内容过大（上限 32 KB）")
    # Strip XML declaration / DOCTYPE / comments before parsing
    cleaned = re.sub(r"<\?xml[^>]*\?>", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"<!DOCTYPE[^>]*>", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL).strip()
    if "<!ENTITY" in cleaned.upper():
        raise ValueError("不允许包含 XML ENTITY 声明")

    try:
        ET.register_namespace("", "http://www.w3.org/2000/svg")
        root = ET.fromstring(cleaned)
    except ET.ParseError as exc:
        raise ValueError(f"无效的 SVG XML 格式: {exc}") from exc

    if _local_tag(root.tag) != "svg":
        raise ValueError("Logo 必须是有效的 <svg> 根节点")

    def _clean_elem(elem: ET.Element) -> None:
        for child in list(elem):
            if _local_tag(child.tag) in _FORBIDDEN_SVG_TAGS:
                elem.remove(child)
                continue
            _clean_elem(child)
        for attr_name in list(elem.attrib.keys()):
            local_attr = _local_tag(attr_name)
            val = (elem.attrib.get(attr_name) or "").strip()
            if local_attr.startswith("on"):
                del elem.attrib[attr_name]
                continue
            if local_attr in {"href", "xlink:href"}:
                # Only allow intra-document #id references inside SVGs (e.g. gradients/clipPaths)
                if not val.startswith("#"):
                    del elem.attrib[attr_name]
                    continue
            if _DANGEROUS_URI_RE.search(val) or "javascript:" in val.lower() or "expression(" in val.lower():
                del elem.attrib[attr_name]

    _clean_elem(root)
    if "xmlns" not in root.attrib and not root.tag.startswith("{"):
        root.attrib["xmlns"] = "http://www.w3.org/2000/svg"
    return ET.tostring(root, encoding="unicode")


def sanitize_brand_favicon(raw: str | None) -> str:
    """Validate and sanitize a custom favicon (inline SVG, safe image data URI, or http(s)/relative URL)."""
    if raw is None:
        return ""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    if len(cleaned) > 65536:
        raise ValueError("Favicon 内容过大（上限 64 KB）")
    if cleaned.startswith("<"):
        return sanitize_brand_svg(cleaned)
    if _SAFE_FAVICON_DATA_URI_RE.fullmatch(cleaned):
        return cleaned
    if _SAFE_FAVICON_URL_RE.fullmatch(cleaned):
        return cleaned
    raise ValueError("Favicon 仅支持 SVG 代码、图片 Base64 Data URI 或 http(s)/站内路径 URL")



def create_llm_profile(
    db: Session,
    name: str,
    base_url: str,
    model: str,
    ciphertext: str = "",
    *,
    api_protocol: str = "openai-completions",
    context_window: int | None = None,
    max_tokens: int | None = None,
    supports_image: bool = False,
    reasoning_effort: str | None = None,
    thinking_format: str | None = None,
) -> LlmProfile:
    clean_protocol = (api_protocol or "openai-completions").strip()
    clean_reasoning = (reasoning_effort or "").strip() or None
    clean_thinking_fmt = (
        (thinking_format or "").strip() or None
        if clean_protocol == "openai-completions"
        else None
    )
    profile = LlmProfile(
        name=name.strip(),
        base_url=base_url.strip(),
        model=model.strip(),
        api_protocol=clean_protocol,
        context_window=context_window,
        max_tokens=max_tokens,
        supports_image=bool(supports_image),
        reasoning_effort=clean_reasoning,
        thinking_format=clean_thinking_fmt,
        api_key_ciphertext=ciphertext,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_llm_profile(
    db: Session,
    profile: LlmProfile,
    *,
    name: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    ciphertext: str | None = None,
    clear_api_key: bool = False,
    api_protocol: str | None = None,
    context_window: int | None = None,
    max_tokens: int | None = None,
    supports_image: bool | None = None,
    reasoning_effort: str | None = None,
    thinking_format: str | None = None,
    fields_set: set[str] | None = None,
) -> LlmProfile:
    provided = fields_set or set()
    if name is not None:
        profile.name = name.strip()
    if base_url is not None:
        profile.base_url = base_url.strip()
    if model is not None:
        profile.model = model.strip()
    if clear_api_key:
        profile.api_key_ciphertext = ""
    elif ciphertext is not None:
        profile.api_key_ciphertext = ciphertext
    if api_protocol is not None:
        profile.api_protocol = api_protocol.strip()
    if "context_window" in provided or context_window is not None:
        profile.context_window = context_window
    if "max_tokens" in provided or max_tokens is not None:
        profile.max_tokens = max_tokens
    if supports_image is not None:
        profile.supports_image = bool(supports_image)
    if "reasoning_effort" in provided or reasoning_effort is not None:
        profile.reasoning_effort = (reasoning_effort or "").strip() or None
    if "thinking_format" in provided or thinking_format is not None:
        profile.thinking_format = (thinking_format or "").strip() or None
    if (profile.api_protocol or "openai-completions") != "openai-completions":
        profile.thinking_format = None
    db.commit()
    db.refresh(profile)
    return profile


def get_idle_sleep_policy(db: Session, settings: Settings) -> tuple[bool, int]:
    """Return global (enabled, idle_minutes) policy with DB override over env defaults."""
    enabled_row = db.get(PlatformSetting, "idle_sleep_enabled")
    minutes_row = db.get(PlatformSetting, "idle_sleep_minutes")

    enabled = settings.idle_sleep_enabled
    if enabled_row is not None:
        enabled = enabled_row.value.strip().lower() in {"1", "true", "yes", "on"}

    idle_minutes = settings.idle_sleep_minutes
    if minutes_row is not None:
        try:
            parsed = int(minutes_row.value.strip())
            if parsed >= 5:
                idle_minutes = parsed
        except ValueError:
            pass
    return enabled, idle_minutes


def set_idle_sleep_policy(
    db: Session,
    enabled: bool,
    idle_minutes: int,
    actor: str | None = None,
) -> tuple[bool, int]:
    """Persist platform idle auto-sleep policy in SQLite and record an audit entry."""
    pairs = {
        "idle_sleep_enabled": "true" if enabled else "false",
        "idle_sleep_minutes": str(idle_minutes),
    }
    now = utcnow()
    for key, val in pairs.items():
        row = db.get(PlatformSetting, key)
        if row is None:
            db.add(PlatformSetting(key=key, value=val, updated_at=now))
        else:
            row.value = val
            row.updated_at = now
    audit(
        db,
        "policy.idle_sleep",
        target="platform",
        detail=f"enabled={enabled},idle_minutes={idle_minutes}",
        actor=actor,
    )
    db.commit()
    return enabled, idle_minutes


def touch_sandbox_activity(
    db: Session,
    sandbox: Sandbox,
    min_interval_seconds: int = 60,
) -> None:
    """Update sandbox.last_seen_at with debouncing so ForwardAuth subrequests avoid write amplification."""
    now = utcnow()
    last = sandbox.last_seen_at
    if last is not None and (now - last).total_seconds() < min_interval_seconds:
        return
    sandbox.last_seen_at = now
    db.commit()


def get_allow_local_user_login(db: Session, settings: Settings) -> bool:
    """Return whether local email+password user login is enabled (DB overrides mode default)."""
    row = db.get(PlatformSetting, "allow_local_user_login")
    if row is not None:
        return row.value.strip().lower() in {"1", "true", "yes", "on"}
    return settings.manager_auth_mode != "oidc"


def set_allow_local_user_login(
    db: Session,
    allow: bool,
    actor: str | None = None,
) -> bool:
    """Persist whether local user email+password login is allowed."""
    val = "true" if allow else "false"
    now = utcnow()
    row = db.get(PlatformSetting, "allow_local_user_login")
    if row is None:
        db.add(PlatformSetting(key="allow_local_user_login", value=val, updated_at=now))
    else:
        row.value = val
        row.updated_at = now
    audit(
        db,
        "policy.auth",
        target="platform",
        detail=f"allow_local_user_login={allow}",
        actor=actor,
    )
    db.commit()
    return allow


def ensure_bootstrap_oidc_provider(
    db: Session, settings: Settings
) -> OidcProvider | None:
    """One-time migration of legacy .env OIDC_* variables into the oidc_providers table."""
    if db.get(PlatformSetting, "env_oidc_bootstrapped") is not None:
        return None

    issuer = (settings.oidc_issuer_url or "").strip()
    discovery = (settings.oidc_discovery_url or "").strip() or None
    client_id = (settings.oidc_client_id or "").strip()
    if not ((issuer or discovery) and client_id):
        return None

    existing = db.scalar(select(OidcProvider).limit(1))
    now = utcnow()
    if existing is not None:
        db.add(PlatformSetting(key="env_oidc_bootstrapped", value="true", updated_at=now))
        db.commit()
        return None

    raw_secret = (settings.oidc_client_secret or "").strip()
    provider = OidcProvider(
        slug="default",
        name="Enterprise SSO",
        enabled=True,
        issuer_url=issuer,
        discovery_url=discovery,
        client_id=client_id,
        client_secret_ciphertext=encrypt_secret(raw_secret) if raw_secret else "",
        scope=" ".join((settings.oidc_scope or "openid profile email").split())
        or "openid profile email",
        email_claim=(settings.oidc_email_claim or "email").strip() or "email",
        logout_url=(settings.oidc_logout_url or "").strip() or None,
        allowed_domains=None,
        allow_admin_login=True,
        sort_order=10,
    )
    db.add(provider)
    db.add(PlatformSetting(key="env_oidc_bootstrapped", value="true", updated_at=now))
    audit(
        db,
        "oidc.bootstrap",
        target=provider.slug,
        detail=f"issuer={issuer or discovery}",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    db.refresh(provider)
    return provider


def list_oidc_providers(
    db: Session, *, enabled_only: bool = False
) -> list[OidcProvider]:
    query = select(OidcProvider)
    if enabled_only:
        query = query.where(OidcProvider.enabled.is_(True))
    query = query.order_by(
        OidcProvider.sort_order.asc(),
        OidcProvider.name.asc(),
        OidcProvider.slug.asc(),
    )
    return list(db.scalars(query).all())


def get_oidc_provider_by_slug(
    db: Session, slug: str, *, enabled_only: bool = False
) -> OidcProvider | None:
    clean_slug = (slug or "").strip().lower()
    if not clean_slug:
        return None
    query = select(OidcProvider).where(OidcProvider.slug == clean_slug)
    if enabled_only:
        query = query.where(OidcProvider.enabled.is_(True))
    return db.scalar(query)


def create_oidc_provider(
    db: Session,
    payload: OidcProviderCreate,
    *,
    actor: str | None = None,
) -> OidcProvider:
    if get_oidc_provider_by_slug(db, payload.slug):
        raise Conflict(f"OIDC 标识 '{payload.slug}' 已存在")
    raw_secret = (payload.client_secret or "").strip()
    provider = OidcProvider(
        slug=payload.slug,
        name=payload.name,
        enabled=bool(payload.enabled),
        issuer_url=payload.issuer_url,
        discovery_url=payload.discovery_url,
        client_id=payload.client_id,
        client_secret_ciphertext=encrypt_secret(raw_secret) if raw_secret else "",
        scope=payload.scope,
        email_claim=payload.email_claim,
        logout_url=payload.logout_url,
        allowed_domains=payload.allowed_domains,
        allow_admin_login=bool(payload.allow_admin_login),
        sort_order=payload.sort_order,
    )
    db.add(provider)
    audit(
        db,
        "oidc.create",
        target=provider.slug,
        detail=f"name={provider.name},enabled={provider.enabled}",
        actor=actor,
    )
    db.commit()
    db.refresh(provider)
    return provider


def update_oidc_provider(
    db: Session,
    provider: OidcProvider,
    payload: OidcProviderUpdate,
    *,
    actor: str | None = None,
) -> OidcProvider:
    provided = set(payload.model_fields_set)
    next_issuer = (
        payload.issuer_url if "issuer_url" in provided and payload.issuer_url is not None else provider.issuer_url
    )
    next_discovery = (
        payload.discovery_url if "discovery_url" in provided else provider.discovery_url
    )
    if not (next_issuer or "").strip() and not (next_discovery or "").strip():
        raise ValueError("issuer_url 和 discovery_url 不能同时为空")

    if payload.name is not None:
        provider.name = payload.name
    if payload.enabled is not None:
        provider.enabled = bool(payload.enabled)
    if "issuer_url" in provided and payload.issuer_url is not None:
        provider.issuer_url = payload.issuer_url
    if "discovery_url" in provided:
        provider.discovery_url = payload.discovery_url
    if payload.client_id is not None:
        provider.client_id = payload.client_id
    if payload.clear_client_secret:
        provider.client_secret_ciphertext = ""
    elif payload.client_secret is not None:
        raw_secret = payload.client_secret.strip()
        if raw_secret:
            provider.client_secret_ciphertext = encrypt_secret(raw_secret)
    if payload.scope is not None:
        provider.scope = payload.scope
    if payload.email_claim is not None:
        provider.email_claim = payload.email_claim
    if "logout_url" in provided:
        provider.logout_url = payload.logout_url
    if "allowed_domains" in provided:
        provider.allowed_domains = payload.allowed_domains
    if payload.allow_admin_login is not None:
        provider.allow_admin_login = bool(payload.allow_admin_login)
    if payload.sort_order is not None:
        provider.sort_order = payload.sort_order

    audit(
        db,
        "oidc.update",
        target=provider.slug,
        detail=f"enabled={provider.enabled},allow_admin={provider.allow_admin_login}",
        actor=actor,
    )
    db.commit()
    db.refresh(provider)
    return provider


def delete_oidc_provider(
    db: Session,
    provider: OidcProvider,
    *,
    actor: str | None = None,
) -> None:
    slug = provider.slug
    audit(db, "oidc.delete", target=slug, actor=actor)
    db.delete(provider)
    db.commit()


def get_branding_config(db: Session) -> dict[str, object]:
    """Return full white-label branding configuration (names, logo SVG, favicon, theme tokens)."""
    zh_row = db.get(PlatformSetting, "brand_name_zh")
    en_row = db.get(PlatformSetting, "brand_name_en")
    logo_row = db.get(PlatformSetting, "brand_logo_svg")
    fav_row = db.get(PlatformSetting, "brand_favicon")
    theme_row = db.get(PlatformSetting, "brand_theme_json")
    zh = (
        zh_row.value.strip()
        if zh_row and zh_row.value and zh_row.value.strip()
        else DEFAULT_BRAND_NAME_ZH
    )
    en = (
        en_row.value.strip()
        if en_row and en_row.value and en_row.value.strip()
        else DEFAULT_BRAND_NAME_EN
    )
    logo_svg = logo_row.value.strip() if logo_row and logo_row.value else ""
    favicon = fav_row.value.strip() if fav_row and fav_row.value else ""
    theme = dict(DEFAULT_BRAND_THEME)
    if theme_row and theme_row.value:
        try:
            parsed = json.loads(theme_row.value)
            if isinstance(parsed, dict):
                theme = sanitize_brand_theme(parsed)
        except Exception:
            pass
    return {
        "brand_name_zh": zh,
        "brand_name_en": en,
        "brand_logo_svg": logo_svg,
        "brand_favicon": favicon,
        "brand_theme": theme,
    }


def get_branding_settings(db: Session) -> tuple[str, str]:
    """Return (brand_name_zh, brand_name_en) with DB override over Metis defaults."""
    cfg = get_branding_config(db)
    return str(cfg["brand_name_zh"]), str(cfg["brand_name_en"])


def set_branding_config(
    db: Session,
    brand_name_zh: str,
    brand_name_en: str,
    *,
    brand_logo_svg: str | None = None,
    brand_favicon: str | None = None,
    brand_theme: dict[str, str] | None = None,
    actor: str | None = None,
) -> dict[str, object]:
    clean_zh = brand_name_zh.strip() or DEFAULT_BRAND_NAME_ZH
    clean_en = brand_name_en.strip() or DEFAULT_BRAND_NAME_EN
    now = utcnow()
    updates: list[tuple[str, str]] = [
        ("brand_name_zh", clean_zh),
        ("brand_name_en", clean_en),
    ]
    if brand_logo_svg is not None:
        updates.append(("brand_logo_svg", sanitize_brand_svg(brand_logo_svg)))
    if brand_favicon is not None:
        updates.append(("brand_favicon", sanitize_brand_favicon(brand_favicon)))
    if brand_theme is not None:
        clean_theme = sanitize_brand_theme(brand_theme)
        updates.append(("brand_theme_json", json.dumps(clean_theme, ensure_ascii=False)))
    for key, val in updates:
        row = db.get(PlatformSetting, key)
        if row is None:
            db.add(PlatformSetting(key=key, value=val, updated_at=now))
        else:
            row.value = val
            row.updated_at = now
    audit(
        db,
        "policy.branding",
        target="platform",
        detail=(
            f"zh={clean_zh},en={clean_en},"
            f"custom_logo={brand_logo_svg is not None and bool(brand_logo_svg.strip())},"
            f"custom_favicon={brand_favicon is not None and bool(brand_favicon.strip())},"
            f"theme={brand_theme.get('mode') if isinstance(brand_theme, dict) else 'unchanged'}"
        ),
        actor=actor,
    )
    db.commit()
    return get_branding_config(db)


def set_branding_settings(
    db: Session,
    brand_name_zh: str,
    brand_name_en: str,
    *,
    actor: str | None = None,
) -> tuple[str, str]:
    cfg = set_branding_config(db, brand_name_zh, brand_name_en, actor=actor)
    return cfg["brand_name_zh"], cfg["brand_name_en"]


