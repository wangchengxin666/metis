from __future__ import annotations

import json
import posixpath
import re
import secrets
import time
from typing import Any

from ..models import Sandbox
from .errors import SandboxRuntimeError


class WorkforceOperationsMixin:
    """Online runtime controls for services, preview apps, cron, mesh tasks/approvals, and vault sync."""

    def control_user_service(
        self,
        sandbox: Sandbox,
        service_name: str,
        action: str,
    ) -> dict[str, Any]:
        """Start, stop, or restart a user-level supervisord service inside a running sandbox."""
        clean_name = (service_name or "").strip()
        if not re.fullmatch(r"[a-z0-9_-]{1,64}", clean_name):
            raise SandboxRuntimeError(f"invalid service name: {service_name}")
        if action not in {"start", "stop", "restart"}:
            raise SandboxRuntimeError(f"unsupported service action: {action}")
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")

        ec, out = self.exec_command(
            sandbox,
            [
                "supervisorctl",
                "-c",
                "/home/workspace/.dsh-sandbox/services/supervisord.conf",
                action,
                clean_name,
            ],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {
            "ok": ec == 0,
            "service": clean_name,
            "action": action,
            "detail": detail[-300:],
        }

    def add_user_service(
        self,
        sandbox: Sandbox,
        *,
        name: str,
        command: str,
    ) -> dict[str, Any]:
        """Register and start a new user-level supervisord service via sandbox-service."""
        clean_name = (name or "").strip()
        if not re.fullmatch(r"[a-z0-9_-]{1,48}", clean_name):
            raise SandboxRuntimeError(f"invalid service name: {name}")
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        ec, out = self.exec_command(
            sandbox,
            ["/usr/local/bin/sandbox-service", "add", clean_name, command],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"ok": ec == 0, "service": clean_name, "action": "add", "detail": detail[-300:]}

    def remove_user_service(
        self,
        sandbox: Sandbox,
        service_name: str,
    ) -> dict[str, Any]:
        """Stop and remove a user-level supervisord service via sandbox-service."""
        clean_name = (service_name or "").strip()
        if not re.fullmatch(r"[a-z0-9_-]{1,48}", clean_name):
            raise SandboxRuntimeError(f"invalid service name: {service_name}")
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        ec, out = self.exec_command(
            sandbox,
            ["/usr/local/bin/sandbox-service", "remove", clean_name],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"ok": ec == 0, "service": clean_name, "action": "remove", "detail": detail[-300:]}

    def user_service_logs(
        self,
        sandbox: Sandbox,
        service_name: str,
        tail: int = 120,
    ) -> str:
        """Read stdout/stderr logs for a user-level supervisord service."""
        clean_name = (service_name or "").strip()
        if not re.fullmatch(r"[a-z0-9_-]{1,48}", clean_name):
            raise SandboxRuntimeError(f"invalid service name: {service_name}")
        st = self._workload_status(sandbox)
        if st != "running":
            return "(sandbox is not running)"
        ec, out = self.exec_command(
            sandbox,
            [
                "sh",
                "-c",
                f"tail -n {int(tail)} /home/workspace/logs/{clean_name}.log /home/workspace/logs/{clean_name}.err 2>/dev/null || true",
            ],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        _ = ec
        return out.decode("utf-8", errors="replace") if out else ""

    def expose_user_app(
        self,
        sandbox: Sandbox,
        *,
        name: str,
        port: int,
        prefix: str | None = None,
    ) -> dict[str, Any]:
        """Expose a local port inside a running sandbox via sandbox-expose."""
        clean_name = (name or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", clean_name):
            raise SandboxRuntimeError(f"invalid app name: {name}")
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        cmd = ["/usr/local/bin/sandbox-expose", clean_name, str(int(port))]
        if prefix and prefix.strip():
            cmd.append(prefix.strip())
        ec, out = self.exec_command(
            sandbox,
            cmd,
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "SANDBOX_BASE_PATH": f"/s/{sandbox.slug}",
                "SANDBOX_PUBLIC_ORIGIN": self.settings.manager_base_url,
            },
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {
            "ok": ec == 0,
            "name": clean_name,
            "port": int(port),
            "url": f"{self.settings.manager_base_url}/s/{sandbox.slug}/apps/{clean_name}/",
            "detail": detail[-300:],
        }

    def unexpose_user_app(
        self,
        sandbox: Sandbox,
        name: str,
    ) -> dict[str, Any]:
        """Remove an exposed preview route via sandbox-expose --remove."""
        clean_name = (name or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", clean_name):
            raise SandboxRuntimeError(f"invalid app name: {name}")
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        ec, out = self.exec_command(
            sandbox,
            ["/usr/local/bin/sandbox-expose", "--remove", clean_name],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"ok": ec == 0, "name": clean_name, "detail": detail[-300:]}

    def add_cron_job(
        self,
        sandbox: Sandbox,
        *,
        schedule: str,
        command: str,
    ) -> dict[str, Any]:
        """Append a persistent cron entry via sandbox-cron add."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        line = f"{schedule.strip()} {command.strip()}"
        ec, out = self.exec_command(
            sandbox,
            ["/usr/local/bin/sandbox-cron", "add", line],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"ok": ec == 0, "line": line, "detail": detail[-300:]}

    def remove_cron_job(
        self,
        sandbox: Sandbox,
        raw_line: str,
    ) -> dict[str, Any]:
        """Remove a matching cron entry from ~/.dsh-sandbox/crontab and reload crontab."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        node_script = """
const fs = require('fs');
const cp = require('child_process');
const cronFile = '/home/workspace/.dsh-sandbox/crontab';
const target = (process.env.CRON_TARGET_LINE || '').trim();
if (fs.existsSync(cronFile)) {
  const lines = fs.readFileSync(cronFile, 'utf8').split(/\\r?\\n/).filter((l) => l.trim() !== target);
  fs.writeFileSync(cronFile, lines.filter(Boolean).join('\\n') + (lines.filter(Boolean).length ? '\\n' : ''), 'utf8');
  try { cp.execFileSync('/usr/local/bin/sandbox-cron', ['sync']); } catch {}
}
console.log('CRON_REMOVED_OK');
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={"HOME": "/home/workspace", "CRON_TARGET_LINE": raw_line},
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"ok": ec == 0, "detail": detail[-200:]}

    def dispatch_mesh_task(
        self,
        sandbox: Sandbox,
        *,
        title: str,
        description: str = "",
        priority: str = "normal",
        room_id: str | None = None,
        approval_required: bool = False,
        source: str = "portal",
        actor: str = "User",
    ) -> dict[str, Any]:
        """Dispatch a task and inbox message into a digital employee's sandbox-mesh.json."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        now_ms = int(time.time() * 1000)
        task_id = f"tsk_{now_ms:x}_{secrets.token_hex(3)}"
        msg_id = f"msg_{now_ms:x}_{secrets.token_hex(3)}"
        payload = {
            "selfSlug": sandbox.slug,
            "taskId": task_id,
            "msgId": msg_id,
            "title": title.strip(),
            "description": description.strip(),
            "priority": priority,
            "roomId": (room_id or "").strip(),
            "approvalRequired": bool(approval_required),
            "source": source,
            "actor": actor,
            "nowMs": now_ms,
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(process.env.TASK_DISPATCH_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
fs.mkdirSync(dshHome, { recursive: true });
let state = { version: 1, self: { slug: cfg.selfSlug }, peers: {}, rooms: {}, messages: {}, tasks: {}, outbox: [] };
if (fs.existsSync(meshPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
    if (raw && typeof raw === 'object') state = { ...state, ...raw };
  } catch {}
}
state.rooms = (state.rooms && typeof state.rooms === 'object') ? state.rooms : {};
state.tasks = (state.tasks && typeof state.tasks === 'object') ? state.tasks : {};
state.messages = (state.messages && typeof state.messages === 'object') ? state.messages : {};

let roomId = cfg.roomId;
if (!roomId || !state.rooms[roomId]) {
  const groupRoom = Object.values(state.rooms).find((r) => r && r.type === 'group' && !r.unpaired);
  if (groupRoom && groupRoom.id) {
    roomId = groupRoom.id;
  } else {
    roomId = 'inbox:portal';
    if (!state.rooms[roomId]) {
      state.rooms[roomId] = {
        id: roomId,
        type: 'group',
        name: 'Portal & Webhook Task Inbox',
        peerSlug: '',
        groupSecret: '',
        createdBy: cfg.selfSlug,
        moderatorSlug: cfg.selfSlug,
        activeThreadId: 'thr_inbox',
        unpaired: false,
        members: [{ slug: cfg.selfSlug, ownerName: cfg.selfSlug }],
        createdAt: cfg.nowMs,
        updatedAt: cfg.nowMs,
        unreadCount: 0,
      };
    }
  }
}

if (!Array.isArray(state.tasks[roomId])) state.tasks[roomId] = [];
const taskObj = {
  id: cfg.taskId,
  roomId,
  title: cfg.title,
  description: cfg.description,
  status: 'open',
  priority: cfg.priority || 'normal',
  assigneeSlug: cfg.selfSlug,
  creatorSlug: cfg.actor || 'portal',
  approvalRequired: Boolean(cfg.approvalRequired),
  approvalStatus: cfg.approvalRequired ? 'pending' : 'none',
  createdAt: cfg.nowMs,
  updatedAt: cfg.nowMs,
};
state.tasks[roomId].unshift(taskObj);

if (!Array.isArray(state.messages[roomId])) state.messages[roomId] = [];
state.messages[roomId].push({
  id: cfg.msgId,
  roomId,
  threadId: (state.rooms[roomId] && state.rooms[roomId].activeThreadId) || 'thr_inbox',
  sender: { slug: cfg.source || 'portal', ownerName: cfg.actor || 'Portal', actor: 'human' },
  kind: 'text',
  text: '[Task Dispatched via ' + cfg.source + '] #' + cfg.taskId + ' ' + cfg.title + (cfg.description ? '\\n' + cfg.description : ''),
  createdAt: cfg.nowMs,
  ackedByAgent: false,
});

const tmp = meshPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
fs.renameSync(tmp, meshPath);
console.log(JSON.stringify({ ok: true, task_id: cfg.taskId, room_id: roomId }));
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "TASK_DISPATCH_PAYLOAD": json.dumps(payload),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec == 0 and text:
            try:
                return json.loads(text.splitlines()[-1])
            except Exception:
                pass
        return {"ok": ec == 0, "task_id": task_id, "room_id": room_id or "inbox:portal", "detail": text[-200:]}

    def decide_mesh_approval(
        self,
        sandbox: Sandbox,
        task_id: str,
        *,
        decision: str,
        note: str = "",
        room_id: str | None = None,
        actor: str = "User",
    ) -> dict[str, Any]:
        """Approve or reject a pending human approval task inside sandbox-mesh.json."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        now_ms = int(time.time() * 1000)
        payload = {
            "taskId": task_id,
            "decision": decision,
            "note": note.strip(),
            "roomId": (room_id or "").strip(),
            "actor": actor,
            "nowMs": now_ms,
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(process.env.APPROVAL_DECISION_PAYLOAD || '{}');
const meshPath = '/home/workspace/.dsh/sandbox-mesh.json';
if (!fs.existsSync(meshPath)) {
  console.log(JSON.stringify({ ok: false, detail: 'sandbox-mesh.json not found' }));
  process.exit(0);
}
const state = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
let found = null;
let foundRoomId = '';
for (const [rId, list] of Object.entries(state.tasks || {})) {
  if (cfg.roomId && rId !== cfg.roomId) continue;
  if (!Array.isArray(list)) continue;
  for (const t of list) {
    if (t && t.id === cfg.taskId) {
      found = t;
      foundRoomId = rId;
      break;
    }
  }
  if (found) break;
}
if (!found) {
  console.log(JSON.stringify({ ok: false, detail: 'task not found' }));
  process.exit(0);
}
found.approvalStatus = cfg.decision;
found.approvalNote = cfg.note || '';
found.approvedBy = cfg.actor;
found.approvedAt = cfg.nowMs;
found.updatedAt = cfg.nowMs;
if (cfg.decision === 'approved' && found.status === 'blocked') {
  found.status = 'in_progress';
} else if (cfg.decision === 'rejected') {
  found.status = 'blocked';
}
state.messages = state.messages || {};
if (!Array.isArray(state.messages[foundRoomId])) state.messages[foundRoomId] = [];
state.messages[foundRoomId].push({
  id: 'msg_' + cfg.nowMs.toString(16),
  roomId: foundRoomId,
  threadId: (state.rooms && state.rooms[foundRoomId] && state.rooms[foundRoomId].activeThreadId) || 'thr_inbox',
  sender: { slug: 'portal', ownerName: cfg.actor, actor: 'human' },
  kind: 'system',
  text: '[Human Approval ' + cfg.decision.toUpperCase() + '] Task #' + found.id + ' (' + (found.title || '') + ')' + (cfg.note ? ': ' + cfg.note : ''),
  createdAt: cfg.nowMs,
  ackedByAgent: false,
});
const tmp = meshPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
fs.renameSync(tmp, meshPath);
console.log(JSON.stringify({ ok: true, task_id: found.id, room_id: foundRoomId, decision: cfg.decision }));
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "APPROVAL_DECISION_PAYLOAD": json.dumps(payload),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec == 0 and text:
            try:
                return json.loads(text.splitlines()[-1])
            except Exception:
                pass
        return {"ok": ec == 0, "task_id": task_id, "decision": decision, "detail": text[-200:]}

    def sync_credential_profile(
        self,
        sandbox: Sandbox,
        *,
        git_user_name: str | None = None,
        git_user_email: str | None = None,
        git_host: str = "github.com",
        git_token: str = "",
        ssh_private_key: str = "",
        env_vars: dict[str, str] | None = None,
        mcp_servers: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Hot-push Git credentials, SSH private key, environment variables, and MCP servers into a digital employee."""
        try:
            st = self._workload_status(sandbox)
        except Exception:
            st = "unknown"
        if st != "running":
            return {"slug": sandbox.slug, "ok": False, "skipped": True, "detail": f"status={st}"}

        payload = {
            "gitUserName": (git_user_name or "").strip(),
            "gitUserEmail": (git_user_email or "").strip(),
            "gitHost": (git_host or "github.com").strip(),
            "gitToken": (git_token or "").strip(),
            "sshPrivateKey": (ssh_private_key or "").strip(),
            "envVars": env_vars or {},
            "mcpServers": mcp_servers or {},
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cfg = JSON.parse(process.env.CRED_SYNC_PAYLOAD || '{}');
const home = '/home/workspace';

if (cfg.gitUserName) {
  try { cp.execFileSync('git', ['config', '--global', 'user.name', cfg.gitUserName]); } catch {}
}
if (cfg.gitUserEmail) {
  try { cp.execFileSync('git', ['config', '--global', 'user.email', cfg.gitUserEmail]); } catch {}
}
if (cfg.gitToken) {
  try { cp.execFileSync('git', ['config', '--global', 'credential.helper', 'store']); } catch {}
  const host = cfg.gitHost.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '') || 'github.com';
  const credLine = 'https://oauth2:' + encodeURIComponent(cfg.gitToken) + '@' + host + '\\n';
  fs.writeFileSync(path.join(home, '.git-credentials'), credLine, { encoding: 'utf8', mode: 0o600 });
}
if (cfg.sshPrivateKey) {
  const sshDir = path.join(home, '.ssh');
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sshDir, 'id_ed25519'), cfg.sshPrivateKey + '\\n', { encoding: 'utf8', mode: 0o600 });
  const sshCfg = 'Host *\\n  StrictHostKeyChecking accept-new\\n  IdentityFile ~/.ssh/id_ed25519\\n';
  fs.writeFileSync(path.join(sshDir, 'config'), sshCfg, { encoding: 'utf8', mode: 0o600 });
}
if (cfg.envVars && Object.keys(cfg.envVars).length > 0) {
  const sbxDir = path.join(home, '.dsh-sandbox');
  fs.mkdirSync(sbxDir, { recursive: true });
  const envLines = Object.entries(cfg.envVars).map(([k, v]) => 'export ' + k + '=' + JSON.stringify(String(v))).join('\\n') + '\\n';
  const envFile = path.join(sbxDir, 'vault.env');
  fs.writeFileSync(envFile, envLines, { encoding: 'utf8', mode: 0o600 });
  const bashrc = path.join(home, '.bashrc');
  const hook = '[ -f ~/.dsh-sandbox/vault.env ] && . ~/.dsh-sandbox/vault.env';
  let rcContent = fs.existsSync(bashrc) ? fs.readFileSync(bashrc, 'utf8') : '';
  if (!rcContent.includes(hook)) {
    fs.writeFileSync(bashrc, rcContent + '\\n' + hook + '\\n', 'utf8');
  }
}
if (cfg.mcpServers && Object.keys(cfg.mcpServers).length > 0) {
  const dshDir = path.join(home, '.dsh');
  fs.mkdirSync(dshDir, { recursive: true });
  const mcpPath = path.join(dshDir, 'mcp.json');
  let mcpData = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (parsed && typeof parsed === 'object') mcpData = parsed;
    } catch {}
  }
  mcpData.mcpServers = { ...(mcpData.mcpServers || {}), ...cfg.mcpServers };
  fs.writeFileSync(mcpPath, JSON.stringify(mcpData, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
}
console.log('CRED_SYNC_OK');
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "CRED_SYNC_PAYLOAD": json.dumps(payload),
            },
        )
        detail = out.decode("utf-8", errors="replace").strip() if out else ""
        return {"slug": sandbox.slug, "ok": ec == 0, "skipped": False, "detail": detail[-200:]}

    def sync_shared_project_file(
        self,
        sandboxes: list[Sandbox],
        *,
        team_name: str,
        file_name: str,
        content: str,
    ) -> dict[str, Any]:
        """Synchronize a shared project document (e.g., PRD, API spec) into /home/workspace/shared/<file_name> across team members."""
        safe_name = posixpath.basename(file_name.strip() or "PROJECT_BRIEF.md")
        node_script = """
const fs = require('fs');
const path = require('path');
const sharedDir = '/home/workspace/shared';
fs.mkdirSync(sharedDir, { recursive: true });
const target = path.join(sharedDir, process.env.SHARED_FILE_NAME || 'PROJECT_BRIEF.md');
fs.writeFileSync(target, process.env.SHARED_FILE_CONTENT || '', 'utf8');
console.log('SHARED_SYNC_OK:' + target);
"""
        results = []
        for sbx in sandboxes:
            try:
                st = self._workload_status(sbx)
            except Exception:
                st = "unknown"
            if st != "running":
                results.append({"slug": sbx.slug, "ok": False, "skipped": True, "detail": f"status={st}"})
                continue
            ec, out = self.exec_command(
                sbx,
                ["node", "-e", node_script],
                user="workspace",
                environment={
                    "HOME": "/home/workspace",
                    "SHARED_FILE_NAME": safe_name,
                    "SHARED_FILE_CONTENT": content,
                },
            )
            detail = out.decode("utf-8", errors="replace").strip() if out else ""
            results.append({"slug": sbx.slug, "ok": ec == 0, "skipped": False, "detail": detail[-200:]})
        synced = sum(1 for r in results if r.get("ok"))
        return {
            "ok": synced > 0,
            "team_name": team_name,
            "file_name": safe_name,
            "synced": synced,
            "total": len(sandboxes),
            "results": results,
        }
