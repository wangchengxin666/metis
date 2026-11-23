from __future__ import annotations

import json
import secrets
import time
from typing import Any

from ..models import Sandbox
from .errors import SandboxRuntimeError


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
            getattr(getattr(sandbox, "user", None), "display_name", None)
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

    def assemble_mesh_team(
        self,
        sandboxes: list[Sandbox],
        team_name: str,
        moderator_slug: str | None = None,
    ) -> dict[str, Any]:
        """Auto-pair a set of digital employees and create a shared group collaboration room across them."""
        if len(sandboxes) < 2:
            raise SandboxRuntimeError("assembling a team requires at least 2 digital employees")

        now_ms = int(time.time() * 1000)
        room_id = f"grp_{now_ms:x}_{secrets.token_hex(4)}"
        thread_id = f"thr_{now_ms:x}_{secrets.token_hex(3)}"
        group_secret = secrets.token_hex(32)
        public_origin = self.settings.manager_base_url

        slugs = [s.slug for s in sandboxes]
        clean_mod = (moderator_slug or "").strip().lower()
        effective_mod = clean_mod if clean_mod in slugs else slugs[0]

        pair_secrets: dict[str, str] = {}
        for i, a in enumerate(slugs):
            for b in slugs[i + 1 :]:
                pair_key = ":".join(sorted([a, b]))
                pair_secrets[pair_key] = secrets.token_hex(32)

        members_list: list[dict[str, Any]] = []
        sop_by_slug: dict[str, str] = {}
        for sbx in sandboxes:
            owner_email = getattr(getattr(sbx, "user", None), "email", "") or ""
            owner_name = (
                getattr(getattr(sbx, "user", None), "display_name", None)
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

state.rooms[cfg.roomId] = {
  id: cfg.roomId,
  type: 'group',
  name: cfg.teamName,
  peerSlug: '',
  groupSecret: cfg.groupSecret,
  createdBy: cfg.moderatorSlug,
  moderatorSlug: cfg.moderatorSlug,
  activeThreadId: cfg.threadId,
  unpaired: false,
  members: cfg.members.map((m) => ({
    slug: m.slug,
    ownerName: m.ownerName,
    ownerEmail: m.ownerEmail,
    role: m.role,
    description: m.description,
    endpointUrl: m.endpointUrl,
  })),
  createdAt: cfg.nowMs,
  updatedAt: cfg.nowMs,
  unreadCount: 0,
  threadSessions: {},
  threadCursors: {},
};
state.messages[cfg.roomId] = [
  {
    id: 'msg_' + cfg.nowMs.toString(36),
    roomId: cfg.roomId,
    threadId: cfg.threadId,
    sender: { slug: cfg.moderatorSlug, ownerName: 'System', actor: 'system' },
    kind: 'system',
    text: 'Team "' + cfg.teamName + '" assembled by control plane (Moderator: @' + cfg.moderatorSlug + ').',
    createdAt: cfg.nowMs,
    ackedByAgent: true,
  },
];

const tmp = meshPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
fs.renameSync(tmp, meshPath);

const sharedDir = '/home/workspace/shared';
try {
  fs.mkdirSync(sharedDir, { recursive: true });
  const rosterLines = cfg.members.map((m) => '- @' + m.slug + ' (' + (m.role || m.ownerName || m.slug) + '): ' + (m.description || '')).join('\\n');
  const readmeContent = '# ' + cfg.teamName + '\\n\\nModerator: @' + cfg.moderatorSlug + '\\n\\n## Team Roster\\n' + rosterLines + '\\n';
  fs.writeFileSync(path.join(sharedDir, 'TEAM_README.md'), readmeContent, 'utf8');
} catch {}

console.log('TEAM_ASSEMBLE_OK:' + cfg.roomId);
"""

        results: list[dict[str, Any]] = []
        for sbx in sandboxes:
            try:
                st = self._workload_status(sbx)
            except Exception:
                st = "unknown"
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
            "room_id": room_id,
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
      for (const r of Object.values(mesh.rooms || {})) {
        if (r && r.type === 'group' && !r.unpaired) {
          meshSummary.groups.push({
            id: r.id,
            name: r.name,
            moderator_slug: r.moderatorSlug || r.createdBy || '',
            member_count: Array.isArray(r.members) ? r.members.length : 0,
          });
        }
      }
      for (const msgList of Object.values(mesh.messages || {})) {
        if (Array.isArray(msgList)) totalMessages += msgList.length;
      }
      for (const [roomId, taskList] of Object.entries(mesh.tasks || {})) {
        if (!Array.isArray(taskList)) continue;
        for (const t of taskList) {
          if (!t || typeof t !== 'object') continue;
          if (t.status === 'done') {
            meshSummary.done_tasks_count += 1;
          } else if (t.status !== 'cancelled') {
            meshSummary.active_tasks_count += 1;
          }
          meshSummary.tasks.push({
            id: t.id,
            room_id: roomId,
            title: t.title || t.id,
            description: t.description || '',
            status: t.status || 'open',
            priority: t.priority || 'normal',
            assignee_slug: t.assigneeSlug || slug,
            approval_required: Boolean(t.approvalRequired),
            approval_status: t.approvalStatus || '',
          });
          if (t.approvalRequired && t.approvalStatus === 'pending') {
            meshSummary.pending_approvals.push({
              id: t.id,
              room_id: roomId,
              title: t.title || t.id,
              assignee_slug: t.assigneeSlug || '',
            });
          }
        }
      }
    }
  } catch {}
}

// 5. Shared project workspace files (/home/workspace/shared)
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

