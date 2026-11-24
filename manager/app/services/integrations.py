"""Bidirectional external integrations: signed IM approval tokens & native GitHub/GitLab webhook adapters."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    pad = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + pad)


def sign_approval_token(
    secret_key: str,
    *,
    sandbox_id: str,
    task_id: str,
    room_id: str = "",
    ttl_seconds: int = 72 * 3600,
) -> str:
    payload = {
        "p": "approval_action",
        "sid": sandbox_id,
        "tid": task_id,
        "rid": room_id or "",
        "exp": int(time.time()) + max(60, int(ttl_seconds)),
    }
    encoded = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    sig = hmac.new(
        secret_key.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{encoded}.{_b64url_encode(sig)}"


def verify_approval_token(secret_key: str, token: str) -> dict[str, Any]:
    raw = (token or "").strip()
    if "." not in raw:
        raise ValueError("无效的审批签名令牌")
    encoded, sig_b64 = raw.rsplit(".", 1)
    expected_sig = hmac.new(
        secret_key.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(_b64url_encode(expected_sig), sig_b64):
        raise ValueError("审批签名校验失败")
    try:
        data = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception as exc:
        raise ValueError("审批令牌解码失败") from exc
    if not isinstance(data, dict) or data.get("p") != "approval_action":
        raise ValueError("审批令牌类型不匹配")
    if int(data.get("exp") or 0) < int(time.time()):
        raise ValueError("审批链接已过期，请前往 Metis 控制台处理")
    if not data.get("sid") or not data.get("tid"):
        raise ValueError("审批令牌缺少目标任务信息")
    return {
        "sandbox_id": str(data["sid"]),
        "task_id": str(data["tid"]),
        "room_id": str(data.get("rid") or ""),
    }


def verify_github_signature(secret: str, raw_body: bytes, sig_header: str | None) -> bool:
    sig = (sig_header or "").strip()
    if not secret or not sig.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, sig)


def parse_native_git_webhook(
    headers: dict[str, str],
    body: dict[str, Any],
) -> dict[str, Any] | None:
    """Translate native GitHub or GitLab webhook payloads into normalized Metis task specs.

    Returns None when headers do not indicate a native GitHub/GitLab event (caller falls back to Metis JSON).
    """
    lower_headers = {k.lower(): v for k, v in headers.items()}

    # --- GitHub Webhooks ---
    gh_event = (lower_headers.get("x-github-event") or "").strip().lower()
    if gh_event:
        repo = (body.get("repository") or {}).get("full_name") or ""
        action = str(body.get("action") or "").lower()

        if gh_event == "ping":
            return {"ignored": True, "source": "github", "event": "ping", "reason": "pong"}

        if gh_event == "issues":
            issue = body.get("issue") or {}
            num = issue.get("number")
            if action not in {"opened", "reopened", "labeled", "edited"}:
                return {"ignored": True, "source": "github", "event": f"issues.{action}", "reason": "skipped action"}
            labels = [str(l.get("name", "")).lower() for l in (issue.get("labels") or []) if isinstance(l, dict)]
            priority = "urgent" if any(x in labels for x in ("p0", "urgent", "critical")) else (
                "high" if any(x in labels for x in ("bug", "p1", "high")) else "normal"
            )
            author = (issue.get("user") or {}).get("login") or "unknown"
            url = issue.get("html_url") or ""
            return {
                "source": "github",
                "event": f"issues.{action}",
                "title": f"[GitHub Issue #{num}] {issue.get('title') or 'Untitled'}"[:200],
                "description": (
                    f"Repository: `{repo}`\nAuthor: @{author}\nURL: {url}\n\n"
                    f"{str(issue.get('body') or '')[:3200]}"
                ),
                "priority": priority,
                "wake_if_sleeping": True,
            }

        if gh_event == "issue_comment":
            if action != "created":
                return {"ignored": True, "source": "github", "event": f"issue_comment.{action}", "reason": "skipped"}
            issue = body.get("issue") or {}
            comment = body.get("comment") or {}
            num = issue.get("number")
            author = (comment.get("user") or {}).get("login") or "unknown"
            url = comment.get("html_url") or issue.get("html_url") or ""
            return {
                "source": "github",
                "event": "issue_comment.created",
                "title": f"[GitHub Comment #{num}] {issue.get('title') or 'Issue Comment'}"[:200],
                "description": (
                    f"Repository: `{repo}`\nCommenter: @{author}\nURL: {url}\n\n"
                    f"{str(comment.get('body') or '')[:3200]}"
                ),
                "priority": "normal",
                "wake_if_sleeping": True,
            }

        if gh_event == "pull_request":
            if action not in {"opened", "reopened", "synchronize", "review_requested"}:
                return {"ignored": True, "source": "github", "event": f"pull_request.{action}", "reason": "skipped"}
            pr = body.get("pull_request") or {}
            num = pr.get("number")
            head_ref = (pr.get("head") or {}).get("ref") or ""
            base_ref = (pr.get("base") or {}).get("ref") or ""
            author = (pr.get("user") or {}).get("login") or "unknown"
            url = pr.get("html_url") or ""
            return {
                "source": "github",
                "event": f"pull_request.{action}",
                "title": f"[GitHub PR #{num}] {pr.get('title') or 'Pull Request'}"[:200],
                "description": (
                    f"Repository: `{repo}` ({head_ref} -> {base_ref})\nAuthor: @{author}\nURL: {url}\n\n"
                    f"{str(pr.get('body') or '')[:3200]}"
                ),
                "priority": "high" if action == "review_requested" else "normal",
                "wake_if_sleeping": True,
            }

        if gh_event == "workflow_run":
            wf = body.get("workflow_run") or {}
            conclusion = str(wf.get("conclusion") or "").lower()
            if action != "completed" or conclusion != "failure":
                return {"ignored": True, "source": "github", "event": f"workflow_run.{conclusion}", "reason": "non-failure"}
            return {
                "source": "github",
                "event": "workflow_run.failure",
                "title": f"[CI Failed] {wf.get('name') or 'Workflow'} ({wf.get('head_branch') or ''})"[:200],
                "description": (
                    f"Repository: `{repo}`\nBranch: `{wf.get('head_branch') or ''}`\n"
                    f"Commit: `{str(wf.get('head_sha') or '')[:12]}`\nRun URL: {wf.get('html_url') or ''}"
                ),
                "priority": "urgent",
                "wake_if_sleeping": True,
            }

        return {
            "source": "github",
            "event": gh_event,
            "title": f"[GitHub {gh_event}] {repo or 'Event'}"[:200],
            "description": json.dumps(body, ensure_ascii=False)[:3000],
            "priority": "normal",
            "wake_if_sleeping": True,
        }

    # --- GitLab Webhooks ---
    gl_event = (lower_headers.get("x-gitlab-event") or "").strip()
    if gl_event:
        project = (body.get("project") or {}).get("path_with_namespace") or ""
        attrs = body.get("object_attributes") or {}
        user = body.get("user") or {}
        author = user.get("username") or user.get("name") or "unknown"

        if gl_event == "Issue Hook":
            iid = attrs.get("iid")
            return {
                "source": "gitlab",
                "event": f"issue.{attrs.get('action') or 'update'}",
                "title": f"[GitLab Issue #{iid}] {attrs.get('title') or 'Issue'}"[:200],
                "description": (
                    f"Project: `{project}`\nAuthor: @{author}\nURL: {attrs.get('url') or ''}\n\n"
                    f"{str(attrs.get('description') or '')[:3200]}"
                ),
                "priority": "normal",
                "wake_if_sleeping": True,
            }

        if gl_event == "Merge Request Hook":
            iid = attrs.get("iid")
            src = attrs.get("source_branch") or ""
            tgt = attrs.get("target_branch") or ""
            return {
                "source": "gitlab",
                "event": f"merge_request.{attrs.get('action') or 'update'}",
                "title": f"[GitLab MR !{iid}] {attrs.get('title') or 'Merge Request'}"[:200],
                "description": (
                    f"Project: `{project}` ({src} -> {tgt})\nAuthor: @{author}\nURL: {attrs.get('url') or ''}\n\n"
                    f"{str(attrs.get('description') or '')[:3200]}"
                ),
                "priority": "high" if attrs.get("action") == "open" else "normal",
                "wake_if_sleeping": True,
            }

        if gl_event == "Note Hook":
            return {
                "source": "gitlab",
                "event": "note.created",
                "title": f"[GitLab Comment] {project}"[:200],
                "description": (
                    f"Project: `{project}`\nAuthor: @{author}\nURL: {attrs.get('url') or ''}\n\n"
                    f"{str(attrs.get('note') or '')[:3200]}"
                ),
                "priority": "normal",
                "wake_if_sleeping": True,
            }

        if gl_event == "Pipeline Hook":
            status = str(attrs.get("status") or "").lower()
            if status != "failed":
                return {"ignored": True, "source": "gitlab", "event": f"pipeline.{status}", "reason": "non-failure"}
            pid = attrs.get("id")
            return {
                "source": "gitlab",
                "event": "pipeline.failed",
                "title": f"[GitLab Pipeline Failed #{pid}] {project} ({attrs.get('ref') or ''})"[:200],
                "description": (
                    f"Project: `{project}`\nRef: `{attrs.get('ref') or ''}`\n"
                    f"Commit: `{str(attrs.get('sha') or '')[:12]}`"
                ),
                "priority": "urgent",
                "wake_if_sleeping": True,
            }

        return {
            "source": "gitlab",
            "event": gl_event.lower().replace(" ", "_"),
            "title": f"[GitLab {gl_event}] {project}"[:200],
            "description": json.dumps(body, ensure_ascii=False)[:3000],
            "priority": "normal",
            "wake_if_sleeping": True,
        }

    return None
