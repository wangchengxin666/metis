from __future__ import annotations

import json
import re
import secrets
import time
from typing import Any

from ..models import Sandbox
from .errors import SandboxRuntimeError


def _sanitize_project_slug(project_slug: str | None) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", (project_slug or "").strip().lower()).strip("-")[:64]


class WorkforceInspectMixin:
    """Digital employee persona sync, mesh team assembly, and live runtime inspection."""

    def sync_role_profile(self, sandbox: Sandbox) -> dict[str, Any]:
        """Sync digital employee role title, specialty description, and private SOP into sandbox-mesh.json."""
        try:
            st = self._workload_status(sandbox)
        except Exception:
            st = "unknown"
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "skipped": True, "detail": f"status={st}"}

        owner_email = getattr(getattr(sandbox, "user", None), "email", "") or ""
        owner_name = (
            getattr(sandbox, "effective_display_name", None)
            or getattr(getattr(sandbox, "user", None), "display_name", None)
            or (owner_email.split("@")[0] if owner_email else sandbox.slug)
        )
        public_origin = self.settings.manager_base_url
        base_path = f"/s/{sandbox.slug}"
        payload = {
            "slug": sandbox.slug,
            "ownerName": owner_name,
            "ownerEmail": owner_email.lower(),
            "role": (getattr(sandbox, "role_title", None) or "").strip(),
            "description": (getattr(sandbox, "role_description", None) or "").strip(),
            "instructions": (getattr(sandbox, "role_sop", None) or "").strip(),
            "publicOrigin": public_origin,
            "basePath": base_path,
            "meshPort": 4090,
            "endpointUrl": f"{public_origin}{base_path}/p/4090",
        }

        node_script = """
const fs = require('fs');
const path = require('path');
const p = JSON.parse(process.env.ROLE_SYNC_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
fs.mkdirSync(dshHome, { recursive: true });
let state = { version: 1, self: {}, activeInvite: null, peers: {}, rooms: {}, messages: {}, tasks: {}, outbox: [] };
if (fs.existsSync(meshPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
    if (raw && typeof raw === 'object') state = { ...state, ...raw };
  } catch {}
}
const prev = (state.self && typeof state.self === 'object') ? state.self : {};
state.self = {
  ...prev,
  slug: p.slug || prev.slug || 'sandbox',
  ownerName: p.ownerName || prev.ownerName || p.slug,
  ownerEmail: p.ownerEmail || prev.ownerEmail || '',
  role: p.role !== undefined ? p.role : (prev.role || ''),
  description: p.description !== undefined ? p.description : (prev.description || ''),
  instructions: p.instructions !== undefined ? p.instructions : (prev.instructions || ''),
  publicOrigin: p.publicOrigin || prev.publicOrigin || 'http://localhost:9000',
  basePath: p.basePath || prev.basePath || ('/s/' + p.slug),
  meshPort: p.meshPort || prev.meshPort || 4090,
  endpointUrl: p.endpointUrl || prev.endpointUrl || '',
};
if (state.rooms && typeof state.rooms === 'object') {
  for (const room of Object.values(state.rooms)) {
    if (room && Array.isArray(room.members)) {
      for (const m of room.members) {
        if (m && m.slug === state.self.slug) {
          m.ownerName = state.self.ownerName;
          m.role = state.self.role;
          m.description = state.self.description;
          m.endpointUrl = state.self.endpointUrl;
        }
      }
    }
  }
}
const tmp = meshPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
fs.renameSync(tmp, meshPath);
console.log('ROLE_SYNC_OK:' + state.self.slug);
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "DSH_HOME": "/home/workspace/.dsh",
                "ROLE_SYNC_PAYLOAD": json.dumps(payload),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"slug": sandbox.slug, "ok": ec == 0, "skipped": False, "detail": text[-200:]}

    def _call_mesh_local_cli(
        self,
        sandbox: Sandbox,
        body: dict[str, Any],
        *,
        timeout_ms: int = 8000,
    ) -> dict[str, Any]:
        """Invoke @metis/sandbox-mesh live /local/cli over container loopback using its 0600 local token."""
        node_script = """
const fs = require('fs');
const http = require('http');
const tokenPath = '/home/workspace/.dsh/sandbox-mesh.local-token';
const meshPort = Number(process.env.SANDBOX_MESH_PORT || 4090) || 4090;
const timeoutMs = Number(process.env.MESH_CLI_TIMEOUT_MS || 8000) || 8000;
if (!fs.existsSync(tokenPath)) {
  console.log(JSON.stringify({ ok: false, error: 'token_missing' }));
  process.exit(0);
}
const token = fs.readFileSync(tokenPath, 'utf8').trim();
if (!token) {
  console.log(JSON.stringify({ ok: false, error: 'token_empty' }));
  process.exit(0);
}
const raw = process.env.MESH_CLI_BODY || '{}';
const req = http.request(
  {
    hostname: '127.0.0.1',
    port: meshPort,
    path: '/local/cli',
    method: 'POST',
    timeout: timeoutMs,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(raw),
      authorization: 'Bearer ' + token,
    },
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const ok = res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false;
        console.log(JSON.stringify({ ok, status: res.statusCode, data: parsed, error: parsed.error || '' }));
      } catch (err) {
        console.log(JSON.stringify({ ok: false, status: res.statusCode || 500, error: String(err) }));
      }
    });
  },
);
req.on('error', (err) => {
  console.log(JSON.stringify({ ok: false, status: 0, error: err && err.message ? err.message : String(err) }));
});
req.on('timeout', () => {
  req.destroy();
  console.log(JSON.stringify({ ok: false, status: 0, error: 'timeout' }));
});
req.write(raw);
req.end();
"""
        try:
            ec, out = self.exec_command(
                sandbox,
                ["node", "-e", node_script],
                user="workspace",
                environment={
                    "HOME": "/home/workspace",
                    "DSH_HOME": "/home/workspace/.dsh",
                    "MESH_CLI_BODY": json.dumps(body, ensure_ascii=False),
                    "MESH_CLI_TIMEOUT_MS": str(int(timeout_ms)),
                },
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec != 0 or not text:
            return {"ok": False, "error": text[-200:] or f"exit {ec}"}
        try:
            parsed = json.loads(text.splitlines()[-1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return {"ok": False, "error": text[-200:]}

    def remove_mesh_group_member(
        self,
        sandboxes: list[Sandbox],
        room_id: str,
        member_slug: str,
    ) -> dict[str, Any]:
        """Remove a detached member from an existing live project mesh group room via its group creator."""
        clean_room = (room_id or "").strip()
        clean_slug = (member_slug or "").strip().lower()
        if not clean_room or not clean_slug:
            return {"ok": False, "detail": "missing room_id or member_slug"}
        for sbx in sandboxes:
            try:
                if self._workload_status(sbx) != "running":
                    continue
            except Exception:
                continue
            st_res = self._call_mesh_local_cli(sbx, {"action": "status"})
            if not st_res.get("ok"):
                continue
            rooms = (st_res.get("data") or {}).get("rooms") or []
            room = next(
                (r for r in rooms if isinstance(r, dict) and r.get("id") == clean_room and not r.get("unpaired")),
                None,
            )
            if room and room.get("createdBy") == sbx.slug:
                if sbx.slug == clean_slug:
                    return self._call_mesh_local_cli(
                        sbx, {"action": "group-leave", "roomId": clean_room}, timeout_ms=10000
                    )
                return self._call_mesh_local_cli(
                    sbx,
                    {"action": "group-remove", "roomId": clean_room, "slug": clean_slug},
                    timeout_ms=10000,
                )
        return {"ok": False, "detail": "group creator not running"}

    def _write_project_readme(
        self,
        sandboxes: list[Sandbox],
        *,
        team_name: str,
        moderator_slug: str,
        members_list: list[dict[str, Any]],
        project_slug: str | None = None,
    ) -> str:
        clean_proj = _sanitize_project_slug(project_slug)
        shared_dir = f"/home/workspace/shared/{clean_proj}" if clean_proj else "/home/workspace/shared"
        roster_lines = "\n".join(
            f"- @{m['slug']} ({m.get('role') or m.get('ownerName') or m['slug']}): {m.get('description') or ''}"
            for m in members_list
        )
        readme_content = (
            f"# {team_name}\n\n"
            f"Moderator: @{moderator_slug}\n"
            f"Shared Workspace: `{shared_dir}/`\n\n"
            f"## Project Roster\n{roster_lines}\n"
        )
        node_script = """
const fs = require('fs');
const path = require('path');
const dir = process.env.SHARED_DIR || '/home/workspace/shared';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'TEAM_README.md'), process.env.README_CONTENT || '', 'utf8');
console.log('README_OK');
"""
        for sbx in sandboxes:
            try:
                if self._workload_status(sbx) != "running":
                    continue
                self.exec_command(
                    sbx,
                    ["node", "-e", node_script],
                    user="workspace",
                    environment={
                        "HOME": "/home/workspace",
                        "SHARED_DIR": shared_dir,
                        "README_CONTENT": readme_content,
                    },
                )
            except Exception:
                pass
        return shared_dir

    def assemble_mesh_team(
        self,
        sandboxes: list[Sandbox],
        team_name: str,
        moderator_slug: str | None = None,
        *,
        project_slug: str | None = None,
        existing_room_id: str | None = None,
    ) -> dict[str, Any]:
        """Auto-pair a set of digital employees and create/sync a live shared group room across them.

        Prefers live @metis/sandbox-mesh /local/cli (ECDH pairing + group-create/invite/remove/moderate so
        in-memory rooms stay live and preserve message history), with disk fallback when /local/cli is unreachable.
        """
        if len(sandboxes) < 2:
            raise SandboxRuntimeError("assembling a team requires at least 2 digital employees")

        now_ms = int(time.time() * 1000)
        clean_existing_room = (existing_room_id or "").strip()
        clean_proj = _sanitize_project_slug(project_slug)
        shared_dir = f"/home/workspace/shared/{clean_proj}" if clean_proj else "/home/workspace/shared"
        public_origin = self.settings.manager_base_url

        slugs = [s.slug for s in sandboxes]
        clean_mod = (moderator_slug or "").strip().lower()
        effective_mod = clean_mod if clean_mod in slugs else slugs[0]

        members_list: list[dict[str, Any]] = []
        sop_by_slug: dict[str, str] = {}
        running_sandboxes: list[Sandbox] = []
        status_by_slug: dict[str, str] = {}
        for sbx in sandboxes:
            try:
                st = self._workload_status(sbx)
            except Exception:
                st = "unknown"
            status_by_slug[sbx.slug] = st
            if st == "running":
                running_sandboxes.append(sbx)
            owner_email = getattr(getattr(sbx, "user", None), "email", "") or ""
            owner_name = (
                getattr(sbx, "effective_display_name", None)
                or getattr(getattr(sbx, "user", None), "display_name", None)
                or (owner_email.split("@")[0] if owner_email else sbx.slug)
            )
            base_path = f"/s/{sbx.slug}"
            members_list.append(
                {
                    "slug": sbx.slug,
                    "ownerName": owner_name,
                    "ownerEmail": owner_email.lower(),
                    "role": (getattr(sbx, "role_title", None) or "").strip(),
                    "description": (getattr(sbx, "role_description", None) or "").strip(),
                    "publicOrigin": public_origin,
                    "basePath": base_path,
                    "meshPort": 4090,
                    "endpointUrl": f"{public_origin}{base_path}/p/4090",
                }
            )
            sop_by_slug[sbx.slug] = (getattr(sbx, "role_sop", None) or "").strip()

        # 1. Preferred live /local/cli path when >= 2 members are running
        if len(running_sandboxes) >= 2:
            running_by_slug = {s.slug: s for s in running_sandboxes}
            live_mod = effective_mod if effective_mod in running_by_slug else running_sandboxes[0].slug

            host_sbx: Sandbox | None = None
            host_snap: dict[str, Any] | None = None
            existing_live_room: dict[str, Any] | None = None

            if clean_existing_room:
                # Find the live creator of the existing room among running project members
                probe_order = [running_by_slug[live_mod]] + [
                    s for s in running_sandboxes if s.slug != live_mod
                ]
                for cand in probe_order:
                    st_res = self._call_mesh_local_cli(cand, {"action": "status"})
                    if not st_res.get("ok"):
                        continue
                    data = st_res.get("data") or {}
                    rooms = data.get("rooms") or []
                    matched = next(
                        (
                            r
                            for r in rooms
                            if isinstance(r, dict)
                            and r.get("id") == clean_existing_room
                            and not r.get("unpaired")
                        ),
                        None,
                    )
                    if matched and matched.get("createdBy") == cand.slug:
                        host_sbx = cand
                        host_snap = data
                        existing_live_room = matched
                        break
                    if host_sbx is None:
                        host_sbx = cand
                        host_snap = data
            else:
                cand = running_by_slug[live_mod]
                st_res = self._call_mesh_local_cli(cand, {"action": "status"})
                if st_res.get("ok"):
                    host_sbx = cand
                    host_snap = st_res.get("data") or {}

            if host_sbx is not None and isinstance(host_snap, dict):
                raw_peers = host_snap.get("peers") or []
                paired_slugs: set[str] = set()
                if isinstance(raw_peers, list):
                    for p in raw_peers:
                        if isinstance(p, dict) and p.get("slug"):
                            paired_slugs.add(str(p["slug"]))
                elif isinstance(raw_peers, dict):
                    paired_slugs.update(str(k) for k in raw_peers.keys())

                # Pair host_sbx with any unpaired running project members via ECDH pair-code -> pair
                pair_errors: dict[str, str] = {}
                for peer_sbx in running_sandboxes:
                    if peer_sbx.slug == host_sbx.slug or peer_sbx.slug in paired_slugs:
                        continue
                    code_res = self._call_mesh_local_cli(peer_sbx, {"action": "pair-code"})
                    invite_uri = (
                        ((code_res.get("data") or {}).get("invite") or {}).get("inviteUri")
                        if code_res.get("ok")
                        else ""
                    )
                    if not invite_uri:
                        pair_errors[peer_sbx.slug] = str(code_res.get("error") or "pair-code failed")
                        continue
                    claim_res = self._call_mesh_local_cli(
                        host_sbx,
                        {"action": "pair", "invite": invite_uri},
                        timeout_ms=12000,
                    )
                    if claim_res.get("ok"):
                        paired_slugs.add(peer_sbx.slug)
                    else:
                        pair_errors[peer_sbx.slug] = str(claim_res.get("error") or "pair failed")

                target_member_slugs = [
                    s.slug for s in running_sandboxes if s.slug != host_sbx.slug and s.slug in paired_slugs
                ]
                live_room_id = ""
                if target_member_slugs:
                    if existing_live_room is not None:
                        live_room_id = str(existing_live_room.get("id") or clean_existing_room)
                        current_slugs = {
                            str(m.get("slug"))
                            for m in (existing_live_room.get("members") or [])
                            if isinstance(m, dict) and m.get("slug")
                        }
                        all_project_slugs = set(slugs)
                        to_add = [s for s in target_member_slugs if s not in current_slugs]
                        to_remove = [
                            s for s in current_slugs if s != host_sbx.slug and s not in all_project_slugs
                        ]
                        if to_add:
                            self._call_mesh_local_cli(
                                host_sbx,
                                {
                                    "action": "group-invite",
                                    "roomId": live_room_id,
                                    "memberSlugs": to_add,
                                },
                                timeout_ms=12000,
                            )
                        for rem in to_remove:
                            self._call_mesh_local_cli(
                                host_sbx,
                                {
                                    "action": "group-remove",
                                    "roomId": live_room_id,
                                    "slug": rem,
                                },
                                timeout_ms=10000,
                            )
                        desired_mod = (
                            effective_mod
                            if effective_mod in (current_slugs | set(target_member_slugs) | {host_sbx.slug})
                            else host_sbx.slug
                        )
                        if existing_live_room.get("moderatorSlug") != desired_mod:
                            self._call_mesh_local_cli(
                                host_sbx,
                                {
                                    "action": "group-moderate",
                                    "roomId": live_room_id,
                                    "moderatorSlug": desired_mod,
                                },
                                timeout_ms=10000,
                            )
                    else:
                        desired_mod = (
                            effective_mod
                            if effective_mod in (set(target_member_slugs) | {host_sbx.slug})
                            else host_sbx.slug
                        )
                        create_res = self._call_mesh_local_cli(
                            host_sbx,
                            {
                                "action": "group-create",
                                "name": team_name,
                                "memberSlugs": target_member_slugs,
                                "moderatorSlug": desired_mod,
                            },
                            timeout_ms=12000,
                        )
                        if create_res.get("ok"):
                            created_room = (create_res.get("data") or {}).get("room") or {}
                            live_room_id = str(created_room.get("id") or "")

                if live_room_id:
                    self._write_project_readme(
                        running_sandboxes,
                        team_name=team_name,
                        moderator_slug=effective_mod,
                        members_list=members_list,
                        project_slug=clean_proj or None,
                    )
                    live_results: list[dict[str, Any]] = []
                    for sbx in sandboxes:
                        st = status_by_slug.get(sbx.slug, "unknown")
                        if st != "running":
                            live_results.append(
                                {"slug": sbx.slug, "ok": False, "skipped": True, "detail": f"status={st}"}
                            )
                        elif sbx.slug == host_sbx.slug or sbx.slug in paired_slugs:
                            live_results.append(
                                {
                                    "slug": sbx.slug,
                                    "ok": True,
                                    "skipped": False,
                                    "detail": f"live_mesh:{live_room_id}",
                                }
                            )
                        else:
                            live_results.append(
                                {
                                    "slug": sbx.slug,
                                    "ok": False,
                                    "skipped": False,
                                    "detail": pair_errors.get(sbx.slug, "pair_failed"),
                                }
                            )
                    synced = sum(1 for r in live_results if r.get("ok"))
                    return {
                        "ok": synced >= 2,
                        "via": "mesh_local_cli",
                        "room_id": live_room_id,
                        "shared_dir": shared_dir,
                        "team_name": team_name,
                        "room_name": team_name,
                        "moderator_slug": effective_mod,
                        "members": [m["slug"] for m in members_list],
                        "synced": synced,
                        "paired_members": synced,
                        "total": len(sandboxes),
                        "results": live_results,
                    }

        # 2. Fallback disk-write path when live /local/cli is unavailable
        room_id = clean_existing_room or f"grp_{now_ms:x}_{secrets.token_hex(4)}"
        thread_id = f"thr_{now_ms:x}_{secrets.token_hex(3)}"
        group_secret = secrets.token_hex(32)

        pair_secrets: dict[str, str] = {}
        for i, a in enumerate(slugs):
            for b in slugs[i + 1 :]:
                pair_key = ":".join(sorted([a, b]))
                pair_secrets[pair_key] = secrets.token_hex(32)

        node_script = """
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(process.env.TEAM_ASSEMBLE_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
fs.mkdirSync(dshHome, { recursive: true });

let state = { version: 1, self: {}, activeInvite: null, peers: {}, rooms: {}, messages: {}, tasks: {}, outbox: [] };
if (fs.existsSync(meshPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
    if (raw && typeof raw === 'object') state = { ...state, ...raw };
  } catch {}
}
state.peers = (state.peers && typeof state.peers === 'object') ? state.peers : {};
state.rooms = (state.rooms && typeof state.rooms === 'object') ? state.rooms : {};
state.messages = (state.messages && typeof state.messages === 'object') ? state.messages : {};

const selfMember = cfg.members.find((m) => m.slug === cfg.selfSlug) || {};
const prevSelf = (state.self && typeof state.self === 'object') ? state.self : {};
state.self = {
  ...prevSelf,
  slug: selfMember.slug,
  ownerName: selfMember.ownerName || prevSelf.ownerName || selfMember.slug,
  ownerEmail: selfMember.ownerEmail || prevSelf.ownerEmail || '',
  role: selfMember.role || prevSelf.role || '',
  description: selfMember.description || prevSelf.description || '',
  instructions: cfg.selfSop || prevSelf.instructions || '',
  publicOrigin: selfMember.publicOrigin,
  basePath: selfMember.basePath,
  meshPort: 4090,
  endpointUrl: selfMember.endpointUrl,
};

for (const peer of cfg.members) {
  if (peer.slug === cfg.selfSlug) continue;
  const pairKey = [cfg.selfSlug, peer.slug].sort().join(':');
  const secret = cfg.pairSecrets[pairKey] || cfg.groupSecret;
  const existingPeer = state.peers[peer.slug] || {};
  state.peers[peer.slug] = {
    ...existingPeer,
    slug: peer.slug,
    ownerName: peer.ownerName,
    ownerEmail: peer.ownerEmail,
    role: peer.role || existingPeer.role || '',
    description: peer.description || existingPeer.description || '',
    endpointUrl: peer.endpointUrl,
    sharedSecret: existingPeer.sharedSecret || secret,
    pairedAt: existingPeer.pairedAt || cfg.nowMs,
    lastSeenAt: cfg.nowMs,
    status: 'online',
  };
  const pairRoomId = 'pair:' + pairKey;
  if (!state.rooms[pairRoomId]) {
    state.rooms[pairRoomId] = {
      id: pairRoomId,
      type: 'pair',
      name: peer.ownerName + ' (' + peer.slug + ')',
      peerSlug: peer.slug,
      groupSecret: '',
      createdBy: cfg.selfSlug,
      activeThreadId: cfg.threadId,
      unpaired: false,
      members: [selfMember, peer],
      createdAt: cfg.nowMs,
      updatedAt: cfg.nowMs,
      unreadCount: 0,
      threadSessions: {},
      threadCursors: {},
    };
    state.messages[pairRoomId] = [];
  }
}

const existingRoom = state.rooms[cfg.roomId];
state.rooms[cfg.roomId] = {
  ...(existingRoom || {}),
  id: cfg.roomId,
  type: 'group',
  name: cfg.teamName,
  peerSlug: '',
  groupSecret: (existingRoom && existingRoom.groupSecret) || cfg.groupSecret,
  createdBy: (existingRoom && existingRoom.createdBy) || cfg.moderatorSlug,
  moderatorSlug: cfg.moderatorSlug,
  activeThreadId: (existingRoom && existingRoom.activeThreadId) || cfg.threadId,
  unpaired: false,
  members: cfg.members.map((m) => ({
    slug: m.slug,
    ownerName: m.ownerName,
    ownerEmail: m.ownerEmail,
    role: m.role,
    description: m.description,
    endpointUrl: m.endpointUrl,
  })),
  createdAt: (existingRoom && existingRoom.createdAt) || cfg.nowMs,
  updatedAt: cfg.nowMs,
  unreadCount: (existingRoom && existingRoom.unreadCount) || 0,
  threadSessions: (existingRoom && existingRoom.threadSessions) || {},
  threadCursors: (existingRoom && existingRoom.threadCursors) || {},
};
if (!Array.isArray(state.messages[cfg.roomId]) || state.messages[cfg.roomId].length === 0) {
  state.messages[cfg.roomId] = [
    {
      id: 'msg_' + cfg.nowMs.toString(36),
      roomId: cfg.roomId,
      threadId: state.rooms[cfg.roomId].activeThreadId,
      sender: { slug: cfg.moderatorSlug, ownerName: 'System', actor: 'system' },
      kind: 'system',
      text: 'Team "' + cfg.teamName + '" assembled by control plane (Moderator: @' + cfg.moderatorSlug + ').',
      createdAt: cfg.nowMs,
      ackedByAgent: true,
    },
  ];
}

const tmp = meshPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
fs.renameSync(tmp, meshPath);

const sharedDir = cfg.sharedDir || '/home/workspace/shared';
try {
  fs.mkdirSync(sharedDir, { recursive: true });
  const rosterLines = cfg.members.map((m) => '- @' + m.slug + ' (' + (m.role || m.ownerName || m.slug) + '): ' + (m.description || '')).join('\\n');
  const readmeContent = '# ' + cfg.teamName + '\\n\\nModerator: @' + cfg.moderatorSlug + '\\nShared Workspace: `' + sharedDir + '/`\\n\\n## Team Roster\\n' + rosterLines + '\\n';
  fs.writeFileSync(path.join(sharedDir, 'TEAM_README.md'), readmeContent, 'utf8');
} catch {}

console.log('TEAM_ASSEMBLE_OK:' + cfg.roomId);
"""

        results: list[dict[str, Any]] = []
        for sbx in sandboxes:
            st = status_by_slug.get(sbx.slug, "unknown")
            if st != "running":
                results.append(
                    {"slug": sbx.slug, "ok": False, "skipped": True, "detail": f"status={st}"}
                )
                continue
            payload = {
                "selfSlug": sbx.slug,
                "selfSop": sop_by_slug.get(sbx.slug, ""),
                "roomId": room_id,
                "threadId": thread_id,
                "teamName": team_name,
                "moderatorSlug": effective_mod,
                "groupSecret": group_secret,
                "pairSecrets": pair_secrets,
                "members": members_list,
                "sharedDir": shared_dir,
                "nowMs": now_ms,
            }
            ec, out = self.exec_command(
                sbx,
                ["node", "-e", node_script],
                user="workspace",
                environment={
                    "HOME": "/home/workspace",
                    "DSH_HOME": "/home/workspace/.dsh",
                    "TEAM_ASSEMBLE_PAYLOAD": json.dumps(payload),
                },
            )
            text = out.decode("utf-8", errors="replace").strip() if out else ""
            results.append(
                {
                    "slug": sbx.slug,
                    "ok": ec == 0,
                    "skipped": False,
                    "detail": text[-200:] or ("assembled" if ec == 0 else f"exit {ec}"),
                }
            )

        synced = sum(1 for r in results if r.get("ok"))
        return {
            "ok": synced > 0,
            "via": "disk_fallback",
            "room_id": room_id,
            "shared_dir": shared_dir,
            "team_name": team_name,
            "room_name": team_name,
            "moderator_slug": effective_mod,
            "members": [m["slug"] for m in members_list],
            "synced": synced,
            "paired_members": synced,
            "total": len(sandboxes),
            "results": results,
        }

    def inspect_workforce_runtime(self, sandbox: Sandbox) -> dict[str, Any]:
        """Inspect exposed preview apps, user supervisor services, cron jobs, and mesh collaboration state."""
        daily_limit = getattr(sandbox, "daily_token_limit", None)
        empty = {
            "online": False,
            "slug": sandbox.slug,
            "status": "stopped",
            "preview_auth_mode": getattr(sandbox, "preview_auth_mode", None) or "public",
            "has_webhook_token": bool(getattr(sandbox, "webhook_token", None)),
            "exposed_apps": [],
            "user_services": [],
            "cron_jobs": [],
            "shared_files": [],
            "token_usage": {
                "estimated_tokens": 0,
                "sessions_count": 0,
                "messages_count": 0,
                "daily_limit": daily_limit,
            },
            "mesh_summary": {
                "role": getattr(sandbox, "role_title", None) or "",
                "description": getattr(sandbox, "role_description", None) or "",
                "has_sop": bool(getattr(sandbox, "role_sop", None)),
                "peers": [],
                "groups": [],
                "tasks": [],
                "active_tasks_count": 0,
                "blocked_tasks_count": 0,
                "done_tasks_count": 0,
                "pending_approvals": [],
            },
        }
        try:
            st = self._workload_status(sandbox)
        except Exception:
            return empty
        if st != "running":
            empty["status"] = st
            return empty

        node_script = """
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const zlib = require('zlib');

const home = '/home/workspace';
const publicOrigin = (process.env.PUBLIC_ORIGIN || 'http://localhost:9000').replace(/\\/+$/, '');
const slug = process.env.SANDBOX_SLUG || '';

function formatDshScheduleRule(t) {
  if (!t || typeof t !== 'object') return '';
  if (t.kind === 'cron' && t.expression) return String(t.expression);
  if (t.kind === 'daily' && t.time) return 'daily ' + String(t.time).slice(0, 5);
  if (t.kind === 'weekly' && t.time) {
    const days = Array.isArray(t.weekdays) ? t.weekdays.join(',') : '';
    return 'weekly(' + days + ') ' + String(t.time).slice(0, 5);
  }
  if (t.kind === 'every' && t.everySeconds) {
    const s = Number(t.everySeconds);
    if (s % 3600 === 0) return 'every ' + (s / 3600) + 'h';
    if (s % 60 === 0) return 'every ' + (s / 60) + 'm';
    return 'every ' + s + 's';
  }
  if (t.kind === 'rrule' && t.rrule) return String(t.rrule);
  if (t.scheduledAt) return t.kind + ' ' + String(t.scheduledAt).slice(0, 16).replace('T', ' ');
  return String(t.kind || '');
}

// 1. Exposed apps from /home/workspace/.dsh-sandbox/caddy/apps.d/*.caddy
const appsDir = path.join(home, '.dsh-sandbox', 'caddy', 'apps.d');
const exposedApps = [];
if (fs.existsSync(appsDir)) {
  for (const fname of fs.readdirSync(appsDir).sort()) {
    if (!fname.endsWith('.caddy') || fname === '00-empty.caddy') continue;
    try {
      const content = fs.readFileSync(path.join(appsDir, fname), 'utf8');
      const m = content.match(/^#\\s*App:\\s*(\\S+)\\s*->\\s*(\\S+)\\s*mounted\\s*at\\s*(\\S+)/m);
      if (m) {
        const mountPath = m[3];
        exposedApps.push({
          name: m[1],
          target: m[2],
          mount_path: mountPath,
          url: publicOrigin + mountPath,
        });
      }
    } catch {}
  }
}

// 2. User supervisord services
const confDir = path.join(home, '.dsh-sandbox', 'services', 'conf.d');
const supConf = path.join(home, '.dsh-sandbox', 'services', 'supervisord.conf');
const statusMap = {};
if (fs.existsSync(supConf)) {
  try {
    const rawStatus = cp.execFileSync('supervisorctl', ['-c', supConf, 'status'], { encoding: 'utf8', timeout: 3000 });
    for (const line of rawStatus.split(/\\r?\\n/)) {
      const parts = line.trim().split(/\\s+/);
      if (parts.length >= 2) {
        statusMap[parts[0]] = { status: parts[1], detail: parts.slice(2).join(' ') };
      }
    }
  } catch (e) {
    const out = (e && e.stdout) ? String(e.stdout) : '';
    for (const line of out.split(/\\r?\\n/)) {
      const parts = line.trim().split(/\\s+/);
      if (parts.length >= 2) {
        statusMap[parts[0]] = { status: parts[1], detail: parts.slice(2).join(' ') };
      }
    }
  }
}
const userServices = [];
if (fs.existsSync(confDir)) {
  for (const fname of fs.readdirSync(confDir).sort()) {
    if (!fname.endsWith('.conf')) continue;
    const svcName = fname.slice(0, -5);
    let command = '';
    let directory = '';
    try {
      const content = fs.readFileSync(path.join(confDir, fname), 'utf8');
      const cmdMatch = content.match(/^command=(.+)$/m);
      const dirMatch = content.match(/^directory=(.+)$/m);
      if (cmdMatch) command = cmdMatch[1].trim();
      if (dirMatch) directory = dirMatch[1].trim();
    } catch {}
    const st = statusMap[svcName] || { status: 'UNKNOWN', detail: '' };
    userServices.push({
      name: svcName,
      status: st.status,
      detail: st.detail,
      command,
      directory,
    });
  }
}

// 3. Scheduled tasks: native DSH @deepseek-ai/dsh-schedule + persistent sandbox-cron
const cronJobs = [];
const dshScheduleFile = path.join(home, '.dsh', 'storages', 'schedule.json');
if (fs.existsSync(dshScheduleFile)) {
  try {
    const schedDoc = JSON.parse(fs.readFileSync(dshScheduleFile, 'utf8'));
    const taskMap = (schedDoc && schedDoc.tables && schedDoc.tables.tasks) || {};
    for (const [taskId, task] of Object.entries(taskMap)) {
      if (!task || typeof task !== 'object' || task.status === 'ended') continue;
      cronJobs.push({
        id: task.id || taskId,
        name: task.title || taskId,
        schedule: formatDshScheduleRule(task),
        command: task.prompt || '',
        status: task.status || 'active',
        source: 'dsh-schedule',
        raw: (task.title || taskId) + ' (' + formatDshScheduleRule(task) + ')',
      });
    }
  } catch {}
}
const cronFile = path.join(home, '.dsh-sandbox', 'crontab');
if (fs.existsSync(cronFile)) {
  try {
    const rawCron = fs.readFileSync(cronFile, 'utf8');
    for (const line of rawCron.split(/\\r?\\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const tokens = trimmed.split(/\\s+/);
      if (tokens.length >= 6) {
        cronJobs.push({
          schedule: tokens.slice(0, 5).join(' '),
          command: tokens.slice(5).join(' '),
          source: 'cron',
          raw: trimmed,
        });
      } else {
        cronJobs.push({ schedule: '', command: trimmed, source: 'cron', raw: trimmed });
      }
    }
  } catch {}
}

// 4. Sandbox Mesh collaboration state & tasks
const meshFile = path.join(home, '.dsh', 'sandbox-mesh.json');
const meshSummary = {
  role: '',
  description: '',
  has_sop: false,
  peers: [],
  groups: [],
  tasks: [],
  active_tasks_count: 0,
  blocked_tasks_count: 0,
  done_tasks_count: 0,
  pending_approvals: [],
};
let totalChars = 0;
let totalMessages = 0;
let totalSessions = 0;
if (fs.existsSync(meshFile)) {
  try {
    const meshRaw = fs.readFileSync(meshFile, 'utf8');
    totalChars += meshRaw.length;
    const mesh = JSON.parse(meshRaw);
    if (mesh && typeof mesh === 'object') {
      const selfObj = mesh.self || {};
      meshSummary.role = selfObj.role || '';
      meshSummary.description = selfObj.description || '';
      meshSummary.has_sop = Boolean(selfObj.instructions && String(selfObj.instructions).trim());
      for (const p of Object.values(mesh.peers || {})) {
        if (p && p.slug) {
          meshSummary.peers.push({
            slug: p.slug,
            owner_name: p.ownerName || p.slug,
            role: p.role || '',
            status: p.status || 'online',
          });
        }
      }
      const roomNameById = {};
      for (const r of Object.values(mesh.rooms || {})) {
        if (r && r.id) {
          roomNameById[r.id] = r.name || r.id;
        }
        if (r && r.type === 'group' && !r.unpaired) {
          meshSummary.groups.push({
            id: r.id,
            name: r.name,
            moderator_slug: r.moderatorSlug || r.createdBy || '',
            member_count: Array.isArray(r.members) ? r.members.length : 0,
          });
        }
      }
      const threadTitleByKey = {};
      const cleanThreadTitle = (rawText) => {
        const firstLine = String(rawText || '')
          .split(/\\r?\\n/)
          .map((l) => l.trim())
          .find((l) => Boolean(l)) || '';
        const stripped = firstLine
          .replace(/^(?:@[a-z0-9_-]+\\s+)+/i, '')
          .replace(/^\\[(?:playbook|portal|intake|webhook)[^\\]]*\\]\\s*/i, '')
          .replace(/^#tsk_[a-z0-9_]+\\s+/i, '')
          .replace(/[*`#>]+/g, '')
          .replace(/\\s+/g, ' ')
          .trim();
        return stripped.slice(0, 80);
      };
      for (const [roomId, msgList] of Object.entries(mesh.messages || {})) {
        if (!Array.isArray(msgList)) continue;
        totalMessages += msgList.length;
        for (const m of msgList) {
          if (!m || typeof m !== 'object' || m.kind === 'system') continue;
          const actor = m.sender && m.sender.actor;
          if (actor === 'system') continue;
          const tid = String(m.threadId || '');
          const tKey = roomId + ':' + tid;
          const cur = threadTitleByKey[tKey];
          if (!cur || (cur.actor !== 'human' && actor === 'human')) {
            const title = cleanThreadTitle(m.text);
            if (title) {
              threadTitleByKey[tKey] = { title, actor: actor || 'agent' };
            }
          }
        }
      }
      for (const [roomId, taskList] of Object.entries(mesh.tasks || {})) {
        if (!Array.isArray(taskList)) continue;
        for (const t of taskList) {
          if (!t || typeof t !== 'object') continue;
          const stVal = String(t.status || 'open');
          if (stVal === 'done') {
            meshSummary.done_tasks_count += 1;
          } else if (stVal !== 'cancelled') {
            meshSummary.active_tasks_count += 1;
            if (stVal === 'blocked') {
              meshSummary.blocked_tasks_count += 1;
            }
          }
          const artifacts = Array.isArray(t.artifacts)
            ? t.artifacts.map((a) => String(a || '').trim()).filter(Boolean)
            : [];
          const tid = String(t.threadId || '');
          const threadInfo = threadTitleByKey[roomId + ':' + tid];
          meshSummary.tasks.push({
            id: t.id,
            room_id: roomId,
            room_name: roomNameById[roomId] || roomId,
            thread_id: tid,
            thread_title: (threadInfo && threadInfo.title) || '',
            title: t.title || t.id,
            description: t.description || '',
            summary: t.summary || '',
            status: stVal,
            priority: t.priority || 'normal',
            assignee_slug: t.assigneeSlug || slug,
            approval_required: Boolean(t.approvalRequired),
            approval_status: t.approvalStatus || '',
            approval_decided_by: t.approvalDecidedBy || '',
            approval_note: t.approvalNote || '',
            artifacts,
            created_at: t.createdAt || null,
            updated_at: t.updatedAt || t.createdAt || null,
          });
          if (t.approvalRequired && t.approvalStatus === 'pending') {
            meshSummary.pending_approvals.push({
              id: t.id,
              room_id: roomId,
              room_name: roomNameById[roomId] || roomId,
              title: t.title || t.id,
              description: t.description || '',
              summary: t.summary || '',
              priority: t.priority || 'normal',
              assignee_slug: t.assigneeSlug || slug,
              artifacts,
              updated_at: t.updatedAt || t.createdAt || null,
            });
          }
        }
      }
    }
  } catch {}
}

// 5. Shared project workspace files (/home/workspace/shared and per-project subdirs /home/workspace/shared/<project-slug>/)
const sharedDir = path.join(home, 'shared');
const sharedFiles = [];
if (fs.existsSync(sharedDir)) {
  try {
    for (const fname of fs.readdirSync(sharedDir).sort()) {
      const fpath = path.join(sharedDir, fname);
      const st = fs.statSync(fpath);
      if (st.isFile()) {
        sharedFiles.push({
          name: fname,
          size_bytes: st.size,
        });
      } else if (st.isDirectory()) {
        try {
          for (const sub of fs.readdirSync(fpath).sort()) {
            const subPath = path.join(fpath, sub);
            const sst = fs.statSync(subPath);
            if (sst.isFile()) {
              sharedFiles.push({
                name: fname + '/' + sub,
                size_bytes: sst.size,
              });
            }
          }
        } catch {}
      }
    }
  } catch {}
}

// 6. Accurate token usage from DSH session logs ($DSH_HOME/sessions, JSONL & Zstd-JSONL)
let realTokens = 0;
let inputTokens = 0;
let outputTokens = 0;
let cacheReadTokens = 0;
let dshSessions = 0;
let dshMessages = 0;
const sessionsRoot = path.join(home, '.dsh', 'sessions');
if (fs.existsSync(sessionsRoot)) {
  try {
    for (const projEntry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!projEntry.isDirectory()) continue;
      const projDir = path.join(sessionsRoot, projEntry.name);
      for (const sEntry of fs.readdirSync(projDir, { withFileTypes: true })) {
        if (!sEntry.isDirectory()) continue;
        const sDir = path.join(projDir, sEntry.name);
        const logFiles = fs.readdirSync(sDir).filter((f) => /^session(\\.v\\d+)?\\.jsonl(\\.zstd)?$/.test(f)).sort();
        if (logFiles.length === 0) continue;
        dshSessions += 1;
        const latestFile = path.join(sDir, logFiles[logFiles.length - 1]);
        try {
          const st = fs.statSync(latestFile);
          if (!st.isFile() || st.size > 32 * 1024 * 1024) continue;
          let rawBuf = fs.readFileSync(latestFile);
          if (latestFile.endsWith('.zstd') && typeof zlib.zstdDecompressSync === 'function') {
            rawBuf = zlib.zstdDecompressSync(rawBuf);
          }
          const lines = rawBuf.toString('utf8').split(/\\r?\\n/);
          for (const line of lines) {
            if (!line || line[0] !== '{') continue;
            if (!line.includes('assistant/message') && !line.includes('user/message')) continue;
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'user/message') {
                dshMessages += 1;
              } else if (ev.type === 'assistant/message') {
                dshMessages += 1;
                const u = ev.data && ev.data.usage;
                if (u && typeof u === 'object') {
                  const inp = Number(u.inputTokens) || 0;
                  const out = Number(u.outputTokens) || 0;
                  const cr = Number(u.cacheReadTokens) || 0;
                  const cw = Number(u.cacheWriteTokens) || 0;
                  const tot = Number.isFinite(Number(u.totalTokens)) ? Number(u.totalTokens) : (inp + out + cr + cw);
                  inputTokens += inp;
                  outputTokens += out;
                  cacheReadTokens += cr;
                  realTokens += tot;
                }
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}
}

console.log(JSON.stringify({
  exposed_apps: exposedApps,
  user_services: userServices,
  cron_jobs: cronJobs,
  shared_files: sharedFiles,
  token_usage: {
    estimated_tokens: realTokens > 0 ? realTokens : Math.round(totalChars / 4),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    sessions_count: dshSessions > 0 ? dshSessions : totalSessions,
    messages_count: dshMessages + totalMessages,
    exact: realTokens > 0,
  },
  mesh_summary: meshSummary,
}));
"""
        try:
            ec, out = self.exec_command(
                sandbox,
                ["node", "-e", node_script],
                user="workspace",
                environment={
                    "HOME": "/home/workspace",
                    "PUBLIC_ORIGIN": self.settings.manager_base_url,
                    "SANDBOX_SLUG": sandbox.slug,
                },
            )
            if ec == 0 and out:
                parsed = json.loads(out.decode("utf-8", errors="replace").strip())
                if isinstance(parsed, dict):
                    ms = parsed.get("mesh_summary") or {}
                    if not ms.get("role") and getattr(sandbox, "role_title", None):
                        ms["role"] = sandbox.role_title
                    if not ms.get("description") and getattr(sandbox, "role_description", None):
                        ms["description"] = sandbox.role_description
                    if not ms.get("has_sop") and getattr(sandbox, "role_sop", None):
                        ms["has_sop"] = True
                    ms.setdefault("tasks", [])
                    tu = parsed.get("token_usage") or {}
                    tu["daily_limit"] = daily_limit
                    return {
                        "online": True,
                        "slug": sandbox.slug,
                        "status": "running",
                        "preview_auth_mode": getattr(sandbox, "preview_auth_mode", None) or "public",
                        "has_webhook_token": bool(getattr(sandbox, "webhook_token", None)),
                        "exposed_apps": parsed.get("exposed_apps") or [],
                        "user_services": parsed.get("user_services") or [],
                        "cron_jobs": parsed.get("cron_jobs") or [],
                        "shared_files": parsed.get("shared_files") or [],
                        "token_usage": tu,
                        "mesh_summary": ms,
                    }
        except Exception:
            pass
        empty["online"] = True
        empty["status"] = "running"
        return empty

    def inspect_sandbox_memories(self, sandbox: Sandbox) -> dict[str, Any]:
        """Read structured long-term memories persisted by @metis/sandbox-memory inside the sandbox."""
        try:
            st = self._workload_status(sandbox)
        except Exception:
            st = "unknown"
        if st != "running":
            return {
                "ok": True,
                "online": False,
                "slug": sandbox.slug,
                "status": st,
                "memories": [],
            }

        node_script = r"""
const fs = require('fs');
const path = require('path');
const os = require('os');
const home = process.env.HOME || os.homedir() || '/home/workspace';
const dshHome = process.env.DSH_HOME || path.join(home, '.dsh');
const candidates = [
  path.join(dshHome, 'memory', 'memories.json'),
  path.join(home, '.dsh', 'memory', 'memories.json'),
];
let items = [];
for (const fp of candidates) {
  try {
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.memories) ? parsed.memories : []);
      if (arr.length > 0) {
        items = arr.slice(0, 200).map((m) => ({
          id: String(m.id || ''),
          title: String(m.title || 'Untitled'),
          category: String(m.category || 'fact'),
          source: String(m.source || 'agent'),
          summary: String(m.summary || ''),
          content: String(m.content || m.summary || ''),
          tags: Array.isArray(m.tags) ? m.tags.map(String).slice(0, 10) : [],
          pinned: Boolean(m.pinned),
          enabled: m.enabled !== false,
          updated_at: m.updatedAt || m.updated_at || null,
        })).filter((m) => m.id);
        break;
      }
    }
  } catch {}
}
if (items.length === 0) {
  const mdPath = path.join(home, 'MEMORY.md');
  try {
    if (fs.existsSync(mdPath)) {
      const raw = fs.readFileSync(mdPath, 'utf8').trim();
      if (raw) {
        items.push({
          id: 'workspace_memory_md',
          title: 'Workspace MEMORY.md',
          category: 'project',
          source: 'manual',
          summary: raw.slice(0, 180),
          content: raw.slice(0, 8000),
          tags: ['MEMORY.md'],
          pinned: false,
          enabled: true,
          updated_at: fs.statSync(mdPath).mtimeMs,
        });
      }
    }
  } catch {}
}
items.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (Number(b.updated_at || 0) - Number(a.updated_at || 0)));
process.stdout.write(JSON.stringify({ memories: items }));
"""
        try:
            ec, out = self.exec_command(
                sandbox,
                ["node", "-e", node_script],
                user="workspace",
                environment={"HOME": "/home/workspace"},
            )
            if ec == 0 and out:
                parsed = json.loads(out.decode("utf-8", errors="replace").strip())
                return {
                    "ok": True,
                    "online": True,
                    "slug": sandbox.slug,
                    "status": "running",
                    "memories": parsed.get("memories") or [],
                }
        except Exception:
            pass
        return {
            "ok": True,
            "online": True,
            "slug": sandbox.slug,
            "status": "running",
            "memories": [],
        }


