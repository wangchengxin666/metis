from __future__ import annotations

import base64
import copy
import gzip
import hashlib
import io
import json
import tarfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from .config import Settings


@dataclass
class BuiltPluginPackage:
    slug: str
    name: str
    version: str
    description: str
    package_json: dict[str, Any]
    tarball_bytes: bytes
    shasum: str
    integrity: str
    mtime_ns: int


class PluginRegistryService:
    """Self-hosted DSH Discover index, icon server, tarball packager, and read-only npm registry."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._cache: dict[str, BuiltPluginPackage] = {}

    @property
    def plugins_root(self) -> Path:
        if self.settings.plugins_dir:
            custom = Path(self.settings.plugins_dir)
            if custom.is_dir():
                return custom
        in_container = Path("/app/plugins")
        if in_container.is_dir():
            return in_container
        return Path(__file__).resolve().parents[2] / "plugins"

    def _dir_mtime_ns(self, directory: Path) -> int:
        latest = 0
        for item in directory.rglob("*"):
            if ".test" in item.parts or "node_modules" in item.parts:
                continue
            try:
                stat = item.stat()
                if stat.st_mtime_ns > latest:
                    latest = stat.st_mtime_ns
            except OSError:
                continue
        return latest

    def _should_include(self, rel_path: Path) -> bool:
        parts = rel_path.parts
        if not parts:
            return False
        if parts[0] in {"node_modules", ".git", ".test"}:
            return False
        if any(p.startswith(".env") or p == "__pycache__" for p in parts):
            return False
        return True

    def _build_tarball(self, plugin_dir: Path, pkg: dict[str, Any]) -> BuiltPluginPackage:
        slug = plugin_dir.name
        mtime_ns = self._dir_mtime_ns(plugin_dir)
        cached = self._cache.get(slug)
        if cached and cached.mtime_ns == mtime_ns:
            return cached

        raw_tar = io.BytesIO()
        with tarfile.open(fileobj=raw_tar, mode="w") as tar:
            for file_path in sorted(plugin_dir.rglob("*")):
                if not file_path.is_file():
                    continue
                rel = file_path.relative_to(plugin_dir)
                if not self._should_include(rel):
                    continue
                arcname = f"package/{rel.as_posix()}"
                info = tar.gettarinfo(str(file_path), arcname=arcname)
                info.uid = 0
                info.gid = 0
                info.uname = "root"
                info.gname = "root"
                with file_path.open("rb") as fh:
                    tar.addfile(info, fh)

        gz_buf = io.BytesIO()
        with gzip.GzipFile(
            filename="", mode="wb", fileobj=gz_buf, mtime=0
        ) as gz:
            gz.write(raw_tar.getvalue())

        tarball_bytes = gz_buf.getvalue()
        shasum = hashlib.sha1(tarball_bytes).hexdigest()
        sha512_b64 = base64.b64encode(hashlib.sha512(tarball_bytes).digest()).decode("ascii")
        integrity = f"sha512-{sha512_b64}"

        built = BuiltPluginPackage(
            slug=slug,
            name=str(pkg.get("name") or f"@metis/{slug}"),
            version=str(pkg.get("version") or "1.0.0"),
            description=str(pkg.get("description") or ""),
            package_json=pkg,
            tarball_bytes=tarball_bytes,
            shasum=shasum,
            integrity=integrity,
            mtime_ns=mtime_ns,
        )
        self._cache[slug] = built
        return built

    def list_packages(self) -> list[BuiltPluginPackage]:
        root = self.plugins_root
        if not root.is_dir():
            return []
        packages: list[BuiltPluginPackage] = []
        for child in sorted(root.iterdir()):
            if not child.is_dir() or child.name.startswith(".") or child.name == "icons":
                continue
            pkg_file = child.joinpath("package.json")
            if not pkg_file.is_file():
                continue
            try:
                pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            packages.append(self._build_tarball(child, pkg))
        return packages

    def get_by_slug_or_filename(self, name: str) -> BuiltPluginPackage | None:
        clean = name.removesuffix(".tgz")
        for pkg in self.list_packages():
            if clean in {pkg.slug, f"{pkg.slug}-{pkg.version}"}:
                return pkg
        return None

    def get_by_package_name(self, package_name: str) -> BuiltPluginPackage | None:
        normalized = unquote(package_name).strip("/")
        for pkg in self.list_packages():
            if pkg.name == normalized or pkg.slug == normalized:
                return pkg
        return None

    def build_npm_packument(self, pkg: BuiltPluginPackage, base_url: str) -> dict[str, Any]:
        tarball_url = f"{base_url}/plugins/packages/{pkg.slug}-{pkg.version}.tgz"
        version_meta = copy.deepcopy(pkg.package_json)
        version_meta["name"] = pkg.name
        version_meta["version"] = pkg.version
        version_meta["dist"] = {
            "tarball": tarball_url,
            "shasum": pkg.shasum,
            "integrity": pkg.integrity,
        }
        pub_sec = (pkg.mtime_ns / 1_000_000_000) if pkg.mtime_ns > 0 else time.time()
        published_iso = (
            datetime.fromtimestamp(pub_sec, tz=timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%S.000Z")
        )
        return {
            "_id": pkg.name,
            "name": pkg.name,
            "description": pkg.description,
            "dist-tags": {"latest": pkg.version},
            "time": {
                "created": published_iso,
                "modified": published_iso,
                pkg.version: published_iso,
            },
            "versions": {pkg.version: version_meta},
        }

    def inline_icon_data_url(self, slug: str, icon_ref: str | None = None) -> str | None:
        candidates: list[Path] = []
        if icon_ref and not icon_ref.startswith(("data:", "http://", "https://")):
            candidates.append(self.plugins_root / icon_ref)
        candidates.append(self.plugins_root / "icons" / f"{slug}.svg")
        candidates.append(self.plugins_root / slug / "icon.svg")
        for path in candidates:
            if path.is_file():
                try:
                    raw = path.read_bytes()
                    if len(raw) <= 32 * 1024:
                        ext = path.suffix.lower()
                        mime = (
                            "image/svg+xml"
                            if ext == ".svg"
                            else "image/png"
                            if ext == ".png"
                            else "image/webp"
                            if ext == ".webp"
                            else "image/jpeg"
                        )
                        b64 = base64.b64encode(raw).decode("ascii")
                        return f"data:{mime};base64,{b64}"
                except OSError:
                    continue
        return None

    def build_index(self, base_url: str) -> dict[str, Any]:
        index_path = self.plugins_root / "index.json"
        if index_path.is_file():
            try:
                doc = json.loads(index_path.read_text(encoding="utf-8"))
            except Exception:
                doc = {}
        else:
            doc = {}

        doc.setdefault("format", 1)
        doc.setdefault("title", {"en": "Metis Platform Plugins", "zh": "Metis 平台能力插件"})
        doc.setdefault(
            "description",
            {
                "en": "Built-in plugins maintained and hosted by Metis.",
                "zh": "由 Metis 平台维护与托管的内置能力插件。",
            },
        )

        if self.settings.plugin_index_title_en:
            doc.setdefault("title", {})["en"] = self.settings.plugin_index_title_en
        if self.settings.plugin_index_title_zh:
            doc.setdefault("title", {})["zh"] = self.settings.plugin_index_title_zh

        packages = self.list_packages()
        packages_by_name = {p.name: p for p in packages}
        reachable_base = self.settings.sandbox_reachable_manager_url.rstrip("/")
        npm_registry_url = (
            self.settings.plugin_npm_registry.rstrip("/")
            if self.settings.plugin_npm_registry
            else f"{reachable_base}/plugins/npm"
        )

        existing_order: list[str] = []
        existing_entries: dict[str, dict[str, Any]] = {}
        for item in doc.get("plugins", []):
            if isinstance(item, dict) and item.get("name"):
                name_key = str(item["name"])
                existing_entries[name_key] = copy.deepcopy(item)
                if name_key not in existing_order:
                    existing_order.append(name_key)

        ordered_packages: list[BuiltPluginPackage] = []
        for name_key in existing_order:
            if name_key in packages_by_name:
                ordered_packages.append(packages_by_name[name_key])
        for pkg_obj in packages:
            if pkg_obj.name not in existing_entries:
                ordered_packages.append(pkg_obj)

        merged_plugins: list[dict[str, Any]] = []
        seen_names: set[str] = set()

        # Process live packages in index.json display order so version/files are always up-to-date
        for pkg_obj in ordered_packages:
            seen_names.add(pkg_obj.name)
            entry = existing_entries.get(pkg_obj.name, {})
            pkg_json = pkg_obj.package_json
            market_meta = (
                pkg_json.get("dshMarket")
                if isinstance(pkg_json.get("dshMarket"), dict)
                else {}
            )

            entry["name"] = pkg_obj.name
            if "title" not in entry:
                entry["title"] = market_meta.get("title") or {
                    "en": pkg_obj.slug.replace("-", " ").title(),
                    "zh": pkg_obj.slug,
                }
            if "description" not in entry:
                entry["description"] = market_meta.get("description") or {
                    "en": pkg_obj.description or pkg_obj.name,
                    "zh": pkg_obj.description or pkg_obj.name,
                }

            inline_icon = self.inline_icon_data_url(
                pkg_obj.slug, str(entry.get("icon") or "")
            )
            if inline_icon:
                entry["icon"] = inline_icon
            elif not entry.get("icon"):
                entry["icon"] = f"icons/{pkg_obj.slug}.svg"

            entry["author"] = (
                self.settings.plugin_index_author
                or entry.get("author")
                or str(pkg_json.get("author") or "Metis")
            )

            if self.settings.plugin_git_url:
                entry["repository"] = {
                    "url": self.settings.plugin_git_url,
                    "directory": f"plugins/{pkg_obj.slug}",
                }
                entry["homepage"] = (
                    f"{self.settings.plugin_git_url.rstrip('/')}/tree/main/plugins/{pkg_obj.slug}"
                )
            else:
                entry["homepage"] = f"{base_url}/plugins/index.json"
                # Never emit a non-Git URL (like /plugins/index.json) as `repository`:
                # DSH Plugin Market parses `repository.url` as a Git remote and attempts
                # to clone it for README details, failing with `detailNetwork`.
                entry.pop("repository", None)

            # Ensure keywords are placed under metadata.keywords per DSH format 1
            keywords = (
                (entry.get("metadata") or {}).get("keywords")
                or entry.get("keywords")
                or market_meta.get("keywords")
                or pkg_json.get("keywords")
                or []
            )
            metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
            if keywords and isinstance(keywords, list):
                metadata["keywords"] = [str(k) for k in keywords]
            entry["metadata"] = metadata

            live_pub_ts = int(pkg_obj.mtime_ns // 1_000_000_000) or int(time.time())
            live_engines = (
                pkg_json.get("engines")
                if isinstance(pkg_json.get("engines"), dict)
                else {"dsh": ">=0.2.0 <0.3.0"}
            )
            if (
                self.settings.plugin_source_type == "git"
                and self.settings.plugin_git_url
            ):
                live_source = {
                    "type": "git",
                    "url": self.settings.plugin_git_url,
                    "commit": self.settings.plugin_git_commit or "HEAD",
                    "path": f"plugins/{pkg_obj.slug}",
                }
            else:
                live_source = {
                    "type": "npm",
                    "registry": npm_registry_url,
                }

            versions_list: list[dict[str, Any]] = [
                {
                    "version": pkg_obj.version,
                    "publishTimestamp": live_pub_ts,
                    "source": live_source,
                    "engines": live_engines,
                }
            ]
            for old_ver in entry.get("versions", []):
                if (
                    isinstance(old_ver, dict)
                    and old_ver.get("version")
                    and old_ver.get("version") != pkg_obj.version
                ):
                    old_copy = copy.deepcopy(old_ver)
                    old_copy["source"] = live_source
                    if not old_copy.get("publishTimestamp"):
                        old_copy["publishTimestamp"] = live_pub_ts
                    versions_list.append(old_copy)

            entry["versions"] = versions_list
            merged_plugins.append(entry)

        doc["plugins"] = merged_plugins
        return doc

    def resolve_icon(self, icon_name: str) -> Path | None:
        safe_name = Path(icon_name).name
        if not safe_name or safe_name != icon_name:
            return None
        candidate = self.plugins_root / "icons" / safe_name
        if candidate.is_file():
            return candidate
        slug = safe_name.removesuffix(".svg")
        fallback = self.plugins_root / slug / "icon.svg"
        if fallback.is_file():
            return fallback
        return None
