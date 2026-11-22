from __future__ import annotations

import hashlib
import io
import json
import tarfile
from pathlib import Path

from app.config import Settings
from app.plugin_registry import PluginRegistryService


def _settings_for(plugins_root: Path, **overrides) -> Settings:
    return Settings(
        _env_file=None,
        plugins_dir=str(plugins_root),
        manager_public_url="http://localhost:9000",
        **overrides,
    )


def test_list_packages_builds_tarball_and_excludes_dev_artifacts(tmp_path: Path):
    plugins_root = tmp_path / "plugins"
    pkg_dir = plugins_root / "my-plugin"
    (pkg_dir / "node_modules" / "dep").mkdir(parents=True)
    (pkg_dir / "node_modules" / "dep" / "index.js").write_text("ignored", encoding="utf-8")
    (pkg_dir / ".test").mkdir(parents=True)
    (pkg_dir / ".test" / "test.mjs").write_text("ignored", encoding="utf-8")
    (pkg_dir / ".git").mkdir(parents=True)
    (pkg_dir / ".git" / "HEAD").write_text("ignored", encoding="utf-8")
    (pkg_dir / "locale").mkdir(parents=True)
    (pkg_dir / "index.js").write_text("console.log('hi')\n", encoding="utf-8")
    (pkg_dir / "icon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
    (pkg_dir / "locale" / "en.json").write_text(
        json.dumps({"title": "My Plugin", "description": "Hello"}), encoding="utf-8"
    )
    (pkg_dir / "locale" / "zh.json").write_text(
        json.dumps({"title": "我的插件", "description": "你好"}), encoding="utf-8"
    )
    (pkg_dir / "package.json").write_text(
        json.dumps(
            {
                "name": "@local/my-plugin",
                "version": "2.0.1",
                "dsh": {"bundle": {"patch": "./cordis.patch.yml"}},
            }
        ),
        encoding="utf-8",
    )

    svc = PluginRegistryService(_settings_for(plugins_root))
    pkgs = svc.list_packages()
    assert len(pkgs) == 1
    pkg = pkgs[0]
    assert pkg.slug == "my-plugin"
    assert pkg.name == "@local/my-plugin"
    assert pkg.version == "2.0.1"
    assert pkg.shasum == hashlib.sha1(pkg.tarball_bytes).hexdigest()
    assert pkg.integrity.startswith("sha512-")

    with tarfile.open(fileobj=io.BytesIO(pkg.tarball_bytes), mode="r:gz") as tf:
        names = tf.getnames()
    assert "package/package.json" in names
    assert "package/index.js" in names
    assert all("node_modules" not in n and ".test" not in n and ".git" not in n for n in names)

    # Cached hit and filename lookup + traversal resistance
    assert svc.get_by_slug_or_filename("my-plugin.tgz") is pkg
    assert svc.get_by_slug_or_filename("my-plugin-2.0.1.tgz") is pkg
    assert svc.get_by_package_name("@local/my-plugin") is pkg
    assert svc.get_by_slug_or_filename("../secret") is None


def test_build_npm_packument_and_index_modes(tmp_path: Path):
    plugins_root = tmp_path / "plugins"
    pkg_dir = plugins_root / "alpha"
    pkg_dir.mkdir(parents=True)
    svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    (pkg_dir / "icon.svg").write_text(svg, encoding="utf-8")
    (plugins_root / "icons").mkdir(parents=True)
    (plugins_root / "icons" / "alpha.svg").write_text(svg, encoding="utf-8")
    (pkg_dir / "package.json").write_text(
        json.dumps({"name": "@local/alpha", "version": "0.1.0", "dsh": {"bundle": {}}}),
        encoding="utf-8",
    )
    (plugins_root / "index.json").write_text(
        json.dumps(
            {
                "format": 1,
                "plugins": [
                    {
                        "name": "@local/alpha",
                        "icon": "icons/alpha.svg",
                        "versions": [
                            {
                                "version": "0.1.0",
                                "source": {"type": "npm", "registry": "http://old/plugins/npm"},
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    svc = PluginRegistryService(
        _settings_for(
            plugins_root,
            plugin_source_type="npm",
            plugin_index_title_en="Custom EN",
            plugin_index_title_zh="自定义 ZH",
            plugin_index_author="Custom Org",
        )
    )
    pkg = svc.get_by_slug_or_filename("alpha")
    assert pkg is not None

    packument = svc.build_npm_packument(pkg, "https://mgr.example.com")
    assert packument["dist-tags"]["latest"] == "0.1.0"
    assert "0.1.0" in packument["time"]
    assert packument["time"]["0.1.0"].endswith("Z")
    dist = packument["versions"]["0.1.0"]["dist"]
    assert dist["tarball"] == "https://mgr.example.com/plugins/packages/alpha-0.1.0.tgz"
    assert dist["shasum"] == pkg.shasum
    assert dist["integrity"] == pkg.integrity

    idx = svc.build_index("https://mgr.example.com")
    assert idx["title"] == {"en": "Custom EN", "zh": "自定义 ZH"}
    entry = idx["plugins"][0]
    assert entry["author"] == "Custom Org"
    assert entry["icon"].startswith("data:image/svg+xml;base64,")
    assert "repository" not in entry
    assert entry["versions"][0]["source"] == {
        "type": "npm",
        "registry": "http://localhost:9000/plugins/npm",
    }

    # Git source mode rewrites source metadata cleanly
    git_svc = PluginRegistryService(
        _settings_for(
            plugins_root,
            plugin_source_type="git",
            plugin_git_url="https://git.example.com/repo.git",
            plugin_git_commit="deadbeef",
        )
    )
    git_idx = git_svc.build_index("https://mgr.example.com")
    assert git_idx["plugins"][0]["repository"] == {
        "url": "https://git.example.com/repo.git",
        "directory": "plugins/alpha",
    }
    assert git_idx["plugins"][0]["versions"][0]["source"] == {
        "type": "git",
        "url": "https://git.example.com/repo.git",
        "commit": "deadbeef",
        "path": "plugins/alpha",
    }

    # resolve_icon safely blocks path traversal
    assert git_svc.resolve_icon("alpha.svg") is not None
    assert git_svc.resolve_icon("../package.json") is None


def test_real_repo_plugins_package_cleanly():
    repo_plugins = Path(__file__).resolve().parents[2] / "plugins"
    svc = PluginRegistryService(_settings_for(repo_plugins))
    packages = svc.list_packages()
    slugs = {pkg.slug for pkg in packages}
    assert {"file-manager", "workspace-user", "custom-theme", "sandbox-mesh", "sandbox-memory"}.issubset(slugs)

    for slug in ("file-manager", "workspace-user", "custom-theme", "sandbox-mesh", "sandbox-memory"):
        pkg = svc.get_by_slug_or_filename(slug)
        assert pkg is not None
        assert svc.resolve_icon(f"{slug}.svg") is not None
        with tarfile.open(fileobj=io.BytesIO(pkg.tarball_bytes), mode="r:gz") as tar:
            members = set(tar.getnames())
            assert "package/package.json" in members
            assert "package/client.js" in members
            assert "package/index.js" in members
            assert not any(m.startswith("package/.test/") for m in members)

    idx = svc.build_index("http://localhost:9000")
    names = {item["name"] for item in idx["plugins"]}
    assert {
        "@local/dsh-plugin-file-manager",
        "@dsh-dock/workspace-user",
        "@dsh-dock/custom-theme",
        "@dsh-dock/sandbox-mesh",
        "@dsh-dock/sandbox-memory",
    }.issubset(names)
