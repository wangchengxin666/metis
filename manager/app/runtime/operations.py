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
        """Append a persistent cron entry via sandbox-cron add (with root crontab -u workspace fallback under no-new-privileges)."""
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
        if ec != 0 and "Permission denied" in detail:
            # Under --security-opt=no-new-privileges, SGID /usr/bin/crontab cannot write to /var/spool/cron/crontabs
            # as user=workspace even though ~/.dsh-sandbox/crontab was already appended; reload it as root.
            ec_sync, out_sync = self.exec_command(
                sandbox,
                ["crontab", "-u", "workspace", "/home/workspace/.dsh-sandbox/crontab"],
                user="root",
                environment={"HOME": "/root"},
            )
            if ec_sync == 0:
                ec = 0
                detail = f"added cron entry: {line}"
            else:
                sync_txt = out_sync.decode("utf-8", errors="replace").strip() if out_sync else ""
                detail = sync_txt or detail
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
        if ec == 0:
            # Ensure system crontab for workspace is reloaded even when SGID crontab is blocked by no-new-privileges
            try:
                self.exec_command(
                    sandbox,
                    [
                        "sh",
                        "-c",
                        "if [ -s /home/workspace/.dsh-sandbox/crontab ]; then crontab -u workspace /home/workspace/.dsh-sandbox/crontab; else crontab -u workspace -r 2>/dev/null || true; fi",
                    ],
                    user="root",
                    environment={"HOME": "/root"},
                )
            except Exception:
                pass
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
        room_name: str | None = None,
        new_topic: bool = False,
        approval_required: bool = False,
        source: str = "portal",
        actor: str = "User",
    ) -> dict[str, Any]:
        """Dispatch a task into a digital employee via live @metis/sandbox-mesh /local/cli (waking the Agent),
        with disk fallback only if the live mesh HTTP listener is unavailable."""
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
            "roomName": (room_name or "").strip()[:80],
            "newTopic": bool(new_topic),
            "approvalRequired": bool(approval_required),
            "source": source,
            "actor": actor,
            "nowMs": now_ms,
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const http = require('http');

const cfg = JSON.parse(process.env.TASK_DISPATCH_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
const tokenPath = path.join(dshHome, 'sandbox-mesh.local-token');
const meshPort = Number(process.env.SANDBOX_MESH_PORT || 4090) || 4090;

function callLocalCli(token, bodyObj) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: meshPort,
        path: '/local/cli',
        method: 'POST',
        timeout: 8000,
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
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false, status: res.statusCode, data: parsed });
          } catch (err) {
            resolve({ ok: false, status: res.statusCode || 500, error: String(err) });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err && err.message ? err.message : String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.write(raw);
    req.end();
  });
}

(async () => {
  // 1. Preferred path: live @metis/sandbox-mesh HTTP /local/cli so maybeDispatchAgentWake wakes the real DSH Agent.
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (token) {
      const roomsRes = await callLocalCli(token, { action: 'rooms' });
      if (roomsRes.ok && Array.isArray(roomsRes.data.rooms)) {
        const rooms = roomsRes.data.rooms;
        const selfSlug = String(cfg.selfSlug || '').trim();
        let targetRoom = null;
        if (cfg.roomId) {
          targetRoom = rooms.find((r) => r && r.id === cfg.roomId && !r.unpaired) || null;
        }
        const desiredName = cfg.roomName || (cfg.source && cfg.source.startsWith('playbook:') ? 'Playbook Tasks' : 'Portal & Webhook Task Inbox');
        if (!targetRoom) {
          targetRoom = rooms.find((r) => r && r.type === 'group' && !r.unpaired && r.name === desiredName && Array.isArray(r.members) && r.members.length === 1) || null;
        }
        if (!targetRoom) {
          const created = await callLocalCli(token, {
            action: 'group-create',
            name: desiredName,
            memberSlugs: [],
          });
          if (created.ok && created.data && created.data.room) {
            targetRoom = created.data.room;
          }
        }
        if (!targetRoom) {
          targetRoom = rooms.find((r) => r && !r.unpaired) || null;
        }

        if (targetRoom && targetRoom.id) {
          let threadId = targetRoom.activeThreadId || '';
          if (cfg.newTopic) {
            const topicRes = await callLocalCli(token, { action: 'new-topic', roomId: targetRoom.id });
            if (topicRes.ok && topicRes.data && topicRes.data.threadId) {
              threadId = topicRes.data.threadId;
            }
          }
          const prefix = selfSlug ? ('@' + selfSlug + ' ') : '';
          const header = prefix + '[' + (cfg.source || 'portal') + '] ' + (cfg.title || 'New Task');
          const fullText = cfg.description ? (header + '\\n\\n' + cfg.description) : header;
          const sendRes = await callLocalCli(token, {
            action: 'send',
            roomId: targetRoom.id,
            threadId,
            actor: 'human',
            kind: 'task',
            text: fullText,
          });
          if (sendRes.ok && sendRes.data && sendRes.data.message) {
            const msg = sendRes.data.message;
            console.log(JSON.stringify({
              ok: true,
              task_id: msg.id,
              message_id: msg.id,
              room_id: targetRoom.id,
              thread_id: msg.threadId || threadId || '',
              woke_agent: true,
              via: 'mesh_local_cli',
            }));
            process.exit(0);
          }
        }
      }
    }
  }

  // 2. Fallback path: direct sandbox-mesh.json write when mesh server is unavailable.
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
          name: cfg.roomName || 'Portal & Webhook Task Inbox',
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
    kind: 'task',
    text: '@' + cfg.selfSlug + ' [' + cfg.source + '] #' + cfg.taskId + ' ' + cfg.title + (cfg.description ? '\\n' + cfg.description : ''),
    createdAt: cfg.nowMs,
    ackedByAgent: false,
  });

  const tmp = meshPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, meshPath);
  console.log(JSON.stringify({ ok: true, task_id: cfg.taskId, room_id: roomId, woke_agent: false, via: 'disk_fallback' }));
})();
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

    def inspect_mesh_room_progress(
        self,
        sandbox: Sandbox,
        room_id: str,
        *,
        since_message_id: str = "",
        thread_id: str = "",
    ) -> dict[str, Any]:
        """Inspect live @metis/sandbox-mesh room messages and tasks to detect real Agent completion replies."""
        if not room_id:
            return {"ok": False, "completed": False, "failed": False}
        st = self._workload_status(sandbox)
        if st != "running":
            return {"ok": False, "completed": False, "failed": False, "detail": "sandbox not running"}
        payload = {
            "selfSlug": sandbox.slug,
            "roomId": room_id.strip(),
            "sinceMessageId": (since_message_id or "").strip(),
            "threadId": (thread_id or "").strip(),
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const http = require('http');

const cfg = JSON.parse(process.env.MESH_INSPECT_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
const tokenPath = path.join(dshHome, 'sandbox-mesh.local-token');
const meshPort = Number(process.env.SANDBOX_MESH_PORT || 4090) || 4090;

function callLocalCli(token, bodyObj) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: meshPort,
        path: '/local/cli',
        method: 'POST',
        timeout: 6000,
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
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false, data: parsed });
          } catch {
            resolve({ ok: false, data: {} });
          }
        });
      },
    );
    req.on('error', () => resolve({ ok: false, data: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: {} }); });
    req.write(raw);
    req.end();
  });
}

function extractArtifacts(text, msgs) {
  const found = [];
  const add = (v) => {
    const clean = String(v || '').trim().replace(/[),.;:!?]+$/, '');
    if (clean && !found.includes(clean)) found.push(clean);
  };
  for (const m of msgs) {
    if (m && m.attachment && (m.attachment.savedPath || m.attachment.fileName)) {
      add(m.attachment.savedPath || m.attachment.fileName);
    }
  }
  const urlRe = /https?:\\/\\/[^\\s<>'"`\\)]+/g;
  for (const match of (text || '').match(urlRe) || []) add(match);
  const appRe = /\\/s\\/[a-z0-9-]+\\/apps\\/[a-zA-Z0-9._\\/-]+/g;
  for (const match of (text || '').match(appRe) || []) add(match);
  const pathRe = /`(\\/home\\/workspace\\/[^`\\s]+)`/g;
  let pm;
  while ((pm = pathRe.exec(text || '')) !== null) add(pm[1]);
  return found.slice(0, 12);
}

(async () => {
  let messages = [];
  let tasks = [];
  let via = 'disk';

  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (token) {
      const mRes = await callLocalCli(token, { action: 'messages', roomId: cfg.roomId });
      if (mRes.ok && Array.isArray(mRes.data.messages)) {
        messages = mRes.data.messages;
        via = 'mesh_local_cli';
      }
      const tRes = await callLocalCli(token, { action: 'tasks', roomId: cfg.roomId });
      if (tRes.ok && Array.isArray(tRes.data.tasks)) {
        tasks = tRes.data.tasks;
      }
    }
  }

  if (via !== 'mesh_local_cli' && fs.existsSync(meshPath)) {
    try {
      const state = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
      messages = (state.messages && Array.isArray(state.messages[cfg.roomId])) ? state.messages[cfg.roomId] : [];
      tasks = (state.tasks && Array.isArray(state.tasks[cfg.roomId])) ? state.tasks[cfg.roomId] : [];
    } catch {}
  }

  let startIdx = 0;
  if (cfg.sinceMessageId) {
    const idx = messages.findIndex((m) => m && m.id === cfg.sinceMessageId);
    if (idx >= 0) {
      startIdx = idx + 1;
    } else {
      // Dispatch message not found in this room yet; don't match older messages
      startIdx = messages.length;
    }
  }

  const afterMsgs = messages.slice(startIdx).filter((m) => {
    if (!m) return false;
    if (cfg.threadId && m.threadId && m.threadId !== cfg.threadId) return false;
    return true;
  });

  const agentReplies = afterMsgs.filter((m) =>
    m.sender && m.sender.actor === 'agent' && (!cfg.selfSlug || m.sender.slug === cfg.selfSlug)
  );
  const errorMsgs = afterMsgs.filter((m) =>
    m.sender && m.sender.actor === 'system' && typeof m.text === 'string' && m.text.trim().startsWith('⚠️')
  );

  const matchedTask = cfg.sinceMessageId
    ? tasks.find((t) => t && t.id === cfg.sinceMessageId)
    : null;
  const taskDone = Boolean(matchedTask && (matchedTask.status === 'done' || matchedTask.status === 'in_review'));

  const replyText = agentReplies
    .map((m) => String(m.text || '').trim())
    .filter(Boolean)
    .join('\\n\\n')
    || (taskDone ? String((matchedTask && (matchedTask.summary || matchedTask.description)) || '').trim() : '');

  const errorText = errorMsgs.length ? String(errorMsgs[errorMsgs.length - 1].text || '').trim() : '';
  const artifacts = extractArtifacts(replyText, agentReplies);
  if (matchedTask && Array.isArray(matchedTask.artifacts)) {
    for (const a of matchedTask.artifacts) {
      if (a && !artifacts.includes(String(a))) artifacts.push(String(a));
    }
  }

  const completed = agentReplies.length > 0 || taskDone;
  const failed = !completed && errorMsgs.length > 0;

  console.log(JSON.stringify({
    ok: true,
    via,
    room_id: cfg.roomId,
    completed,
    failed,
    reply_text: replyText.slice(0, 4000),
    error_text: errorText.slice(0, 1000),
    artifacts,
    message_count_after: afterMsgs.length,
  }));
})();
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "MESH_INSPECT_PAYLOAD": json.dumps(payload),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec == 0 and text:
            try:
                return json.loads(text.splitlines()[-1])
            except Exception:
                pass
        return {"ok": False, "completed": False, "failed": False, "detail": text[-200:]}

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
        """Deliver an approval/rejection decision into the live @metis/sandbox-mesh room (with disk fallback)."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        now_ms = int(time.time() * 1000)
        payload = {
            "selfSlug": sandbox.slug,
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
const http = require('http');
const cfg = JSON.parse(process.env.APPROVAL_DECISION_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
const tokenPath = path.join(dshHome, 'sandbox-mesh.local-token');
const meshPort = Number(process.env.SANDBOX_MESH_PORT || 4090) || 4090;

function callLocalCli(token, bodyObj) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: meshPort,
        path: '/local/cli',
        method: 'POST',
        timeout: 6000,
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
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false, data: parsed });
          } catch {
            resolve({ ok: false, data: {} });
          }
        });
      },
    );
    req.on('error', () => resolve({ ok: false, data: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: {} }); });
    req.write(raw);
    req.end();
  });
}

(async () => {
  // 1. Live mesh room notification if roomId exists in live server
  if (cfg.roomId && fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (token) {
      const prefix = cfg.decision === 'revise' && cfg.selfSlug ? ('@' + cfg.selfSlug + ' ') : '';
      const label = cfg.decision === 'approved' ? 'APPROVED' : (cfg.decision === 'revise' ? 'REVISION REQUESTED' : 'REJECTED');
      const text = prefix + '[Human Approval ' + label + '] by ' + (cfg.actor || 'User') + (cfg.note ? ': ' + cfg.note : '');
      const sendRes = await callLocalCli(token, {
        action: 'send',
        roomId: cfg.roomId,
        actor: 'human',
        kind: 'approval',
        text,
      });
      if (sendRes.ok && sendRes.data && sendRes.data.message) {
        console.log(JSON.stringify({ ok: true, task_id: sendRes.data.message.id, room_id: cfg.roomId, decision: cfg.decision, via: 'mesh_local_cli' }));
        process.exit(0);
      }
    }
  }

  // 2. Fallback: update legacy task entry in sandbox-mesh.json
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
})();
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

    def update_mesh_task_status(
        self,
        sandbox: Sandbox,
        task_id: str,
        *,
        status: str,
        summary: str = "",
        room_id: str | None = None,
        actor: str = "User",
        notify_moderator: bool = False,
    ) -> dict[str, Any]:
        """Update a mesh task's status via live @metis/sandbox-mesh /local/cli (syncing to all group peers), with disk fallback."""
        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")
        now_ms = int(time.time() * 1000)
        payload = {
            "selfSlug": sandbox.slug,
            "taskId": (task_id or "").strip(),
            "status": (status or "").strip().lower(),
            "summary": (summary or "").strip(),
            "roomId": (room_id or "").strip(),
            "actor": actor or "User",
            "notifyModerator": bool(notify_moderator),
            "nowMs": now_ms,
        }
        node_script = """
const fs = require('fs');
const path = require('path');
const http = require('http');
const cfg = JSON.parse(process.env.TASK_UPDATE_PAYLOAD || '{}');
const dshHome = '/home/workspace/.dsh';
const meshPath = path.join(dshHome, 'sandbox-mesh.json');
const tokenPath = path.join(dshHome, 'sandbox-mesh.local-token');
const meshPort = Number(process.env.SANDBOX_MESH_PORT || 4090) || 4090;

function callLocalCli(token, bodyObj) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: meshPort,
        path: '/local/cli',
        method: 'POST',
        timeout: 8000,
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
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false, status: res.statusCode, data: parsed });
          } catch (err) {
            resolve({ ok: false, status: res.statusCode || 500, data: { error: String(err) } });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, data: { error: err && err.message ? err.message : String(err) } }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, data: { error: 'timeout' } }); });
    req.write(raw);
    req.end();
  });
}

(async () => {
  // 1. Preferred live path: @metis/sandbox-mesh /local/cli task-update (auto-broadcasts /mesh/task-sync to peers)
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (token) {
      let targetRoomId = cfg.roomId;
      if (!targetRoomId) {
        const roomsRes = await callLocalCli(token, { action: 'rooms' });
        const rooms = (roomsRes.ok && Array.isArray(roomsRes.data.rooms)) ? roomsRes.data.rooms : [];
        for (const rm of rooms) {
          if (!rm || !rm.id) continue;
          const tRes = await callLocalCli(token, { action: 'tasks', roomId: rm.id });
          const list = (tRes.ok && Array.isArray(tRes.data.tasks)) ? tRes.data.tasks : [];
          if (list.some((t) => t && t.id === cfg.taskId)) {
            targetRoomId = rm.id;
            break;
          }
        }
      }
      if (targetRoomId) {
        const body = {
          action: 'task-update',
          roomId: targetRoomId,
          taskId: cfg.taskId,
          status: cfg.status,
          actor: 'human',
          notifyModerator: Boolean(cfg.notifyModerator),
        };
        if (cfg.summary) body.summary = cfg.summary;
        const updRes = await callLocalCli(token, body);
        if (updRes.ok && updRes.data && updRes.data.task) {
          console.log(JSON.stringify({
            ok: true,
            task_id: updRes.data.task.id,
            room_id: targetRoomId,
            status: updRes.data.task.status || cfg.status,
            summary: updRes.data.task.summary || '',
            auto_released_count: Array.isArray(updRes.data.autoReleasedBlockedTasks) ? updRes.data.autoReleasedBlockedTasks.length : 0,
            via: 'mesh_local_cli',
          }));
          process.exit(0);
        }
        if (updRes.status === 404) {
          console.log(JSON.stringify({ ok: false, detail: (updRes.data && updRes.data.error) || 'task not found' }));
          process.exit(0);
        }
      }
    }
  }

  // 2. Fallback: update sandbox-mesh.json atomically on disk
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
  found.status = cfg.status;
  if (cfg.summary) {
    found.summary = cfg.summary;
  }
  found.updatedAt = cfg.nowMs;
  found.version = (Number(found.version) || 1) + 1;
  const tmp = meshPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, meshPath);
  console.log(JSON.stringify({
    ok: true,
    task_id: found.id,
    room_id: foundRoomId,
    status: found.status,
    summary: found.summary || '',
    auto_released_count: 0,
    via: 'disk_fallback',
  }));
})();
"""
        ec, out = self.exec_command(
            sandbox,
            ["node", "-e", node_script],
            user="workspace",
            environment={
                "HOME": "/home/workspace",
                "TASK_UPDATE_PAYLOAD": json.dumps(payload, ensure_ascii=False),
            },
        )
        text = out.decode("utf-8", errors="replace").strip() if out else ""
        if ec == 0 and text:
            try:
                return json.loads(text.splitlines()[-1])
            except Exception:
                pass
        return {"ok": False, "task_id": task_id, "status": status, "detail": text[-200:] or f"exit {ec}"}

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
        project_slug: str | None = None,
    ) -> dict[str, Any]:
        """Synchronize a shared project document into /home/workspace/shared/<project_slug>/<file_name> (or /home/workspace/shared/<file_name>)."""
        safe_name = posixpath.basename(file_name.strip() or "PROJECT_BRIEF.md")
        clean_proj = re.sub(r"[^a-z0-9_-]+", "-", (project_slug or "").strip().lower()).strip("-")[:64]
        shared_dir = f"/home/workspace/shared/{clean_proj}" if clean_proj else "/home/workspace/shared"
        node_script = """
const fs = require('fs');
const path = require('path');
const sharedDir = process.env.SHARED_DIR || '/home/workspace/shared';
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
                    "SHARED_DIR": shared_dir,
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
            "project_slug": clean_proj or None,
            "path": f"{shared_dir}/{safe_name}",
            "file_name": safe_name,
            "synced": synced,
            "total": len(sandboxes),
            "results": results,
        }

    def write_intake_files(
        self,
        sandbox: Sandbox,
        intake_id: str,
        files: list[tuple[str, bytes]],
    ) -> list[str]:
        """Write uploaded intake attachments into /home/workspace/shared-intake/<intake_id>/ safely in chunks."""
        import base64

        st = self._workload_status(sandbox)
        if st != "running":
            raise SandboxRuntimeError(f"sandbox {sandbox.slug} is not running")

        safe_intake = re.sub(r"[^a-zA-Z0-9_-]", "", intake_id)[:48] or "intake"
        target_dir = f"/home/workspace/shared-intake/{safe_intake}"
        self.exec_command(
            sandbox,
            ["mkdir", "-p", target_dir, f"{target_dir}/output"],
            user="workspace",
            environment={"HOME": "/home/workspace"},
        )

        written: list[str] = []
        used_names: set[str] = set()
        chunk_size = 36 * 1024  # 36KB raw -> ~48KB base64, safely below ARG_MAX

        write_chunk_js = """
const fs = require('fs');
const target = process.env.INTAKE_TARGET_PATH;
const buf = Buffer.from(process.env.INTAKE_B64 || '', 'base64');
if (process.env.INTAKE_APPEND === '1') {
  fs.appendFileSync(target, buf);
} else {
  fs.writeFileSync(target, buf, { mode: 0o644 });
}
"""
        for idx, (orig_name, content) in enumerate(files):
            base = posixpath.basename((orig_name or "").replace("\\", "/")).strip()
            clean = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", base).strip("._")[:100]
            if not clean:
                clean = f"attachment-{idx + 1}.bin"
            candidate = clean
            suffix = 1
            while candidate in used_names:
                stem, dot, ext = clean.rpartition(".")
                candidate = f"{stem}_{suffix}.{ext}" if dot else f"{clean}_{suffix}"
                suffix += 1
            used_names.add(candidate)

            target_path = f"{target_dir}/{candidate}"
            if not content:
                ec, _ = self.exec_command(
                    sandbox,
                    ["node", "-e", write_chunk_js],
                    user="workspace",
                    environment={
                        "HOME": "/home/workspace",
                        "INTAKE_TARGET_PATH": target_path,
                        "INTAKE_B64": "",
                        "INTAKE_APPEND": "0",
                    },
                )
                if ec == 0:
                    written.append(target_path)
                continue

            ok_all = True
            for offset in range(0, len(content), chunk_size):
                part = content[offset : offset + chunk_size]
                ec, _ = self.exec_command(
                    sandbox,
                    ["node", "-e", write_chunk_js],
                    user="workspace",
                    environment={
                        "HOME": "/home/workspace",
                        "INTAKE_TARGET_PATH": target_path,
                        "INTAKE_B64": base64.b64encode(part).decode("ascii"),
                        "INTAKE_APPEND": "1" if offset > 0 else "0",
                    },
                )
                if ec != 0:
                    ok_all = False
                    break
            if ok_all:
                written.append(target_path)
        return written
