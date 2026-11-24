export const MESH_CSS = `
/* --- Shared base, icons, buttons & DSH theme tokens --- */
.sm-root, .sm-chat-shell {
  --sm-bg-base: var(--dsw-alias-bg-base, #f8fafc);
  --sm-bg-layer1: var(--dsw-alias-bg-layer-1, #ffffff);
  --sm-bg-layer2: var(--dsw-alias-bg-layer-2, #f1f5f9);
  --sm-bg-sidebar: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #ffffff));
  --sm-bg-input: var(--dsw-specific-input-major, var(--dsw-alias-bg-base, #f8fafc));
  --sm-bg-code: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2, #f1f5f9));
  --sm-bg-bubble-self: var(--dsw-specific-bubble, rgba(14, 165, 233, 0.11));
  --sm-fg-primary: var(--dsw-alias-label-primary, #0f172a);
  --sm-fg-secondary: var(--dsw-alias-label-secondary, #475569);
  --sm-border-l1: var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.22));
  --sm-border-l2: var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.36));
  --sm-accent: var(--dsw-alias-state-business-primary, var(--dsw-alias-link, #0284c7));
  --sm-brand: var(--dsw-alias-brand-primary, #0284c7);
  --sm-brand-fg: var(--dsw-alias-bg-base, #ffffff);
  color: var(--sm-fg-primary);
  background: var(--sm-bg-base);
  font-family: inherit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-sizing: border-box;
}
.sm-root *, .sm-chat-shell * {
  box-sizing: border-box;
}
.sm-icon {
  display: inline-block;
  vertical-align: -0.16em;
  flex-shrink: 0;
}
.sm-nav-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sm-nav-badge-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  min-width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ef4444;
  border: 1.5px solid var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #ffffff));
}
.sm-nav-badge-dot.live {
  background: var(--dsw-alias-state-business-primary, #0ea5e9);
  animation: sm-ring-pulse 1.5s infinite;
}
.sm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 7px;
  border: 1px solid var(--sm-border-l2, var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.36)));
  background: var(--sm-bg-layer1, var(--dsw-alias-bg-layer-1, #ffffff));
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
}
.sm-btn:not(.sm-btn-primary):hover:not(:disabled) {
  background: var(--sm-bg-layer2, var(--dsw-alias-bg-layer-2, #f1f5f9));
  border-color: var(--sm-accent, var(--dsw-alias-link, #0284c7));
}
.sm-btn-primary {
  background: var(--sm-brand, var(--dsw-alias-brand-primary, #0284c7));
  border-color: transparent;
  color: var(--sm-brand-fg, var(--dsw-alias-bg-base, #ffffff));
}
.sm-btn.sm-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
.sm-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--sm-fg-secondary, var(--dsw-alias-label-secondary, #475569));
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.sm-btn-ghost:hover:not(:disabled) {
  background: var(--sm-bg-layer2, var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.16)));
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
}
.sm-btn:disabled, .sm-btn-ghost:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.sm-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font-size: 12.5px;
  border-radius: 7px;
  border: 1px solid var(--sm-border-l2, var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.36)));
  background: var(--sm-bg-input, var(--dsw-specific-input-major, #f8fafc));
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
  outline: none;
  transition: border-color 0.14s ease;
}
.sm-input:focus {
  border-color: var(--sm-accent, var(--dsw-alias-link, #0284c7));
}
.sm-code-inline {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  padding: 2.5px 6px;
  border-radius: 5px;
  background: var(--sm-bg-code, var(--dsw-alias-markdown-code-block, rgba(148, 163, 184, 0.14)));
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
}
.sm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3.5px;
  padding: 1.5px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  background: rgba(14, 165, 233, 0.14);
  color: var(--sm-accent, var(--dsw-alias-link, #0284c7));
}
.sm-badge-moderator {
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.34);
}
.sm-badge-unread {
  background: #ef4444;
  color: #ffffff;
  min-width: 18px;
  justify-content: center;
}
.sm-inline-mention {
  display: inline-flex;
  align-items: center;
  gap: 3.5px;
  padding: 1px 7px;
  margin: 0 2px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(139, 92, 246, 0.15);
  color: #8b5cf6;
  border: 1px solid rgba(139, 92, 246, 0.3);
  vertical-align: baseline;
}
.sm-inline-file {
  display: inline-flex;
  align-items: center;
  gap: 3.5px;
  padding: 1px 7px;
  margin: 0 2px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  background: rgba(14, 165, 233, 0.13);
  color: var(--sm-accent, var(--dsw-alias-link, #0284c7));
  border: 1px solid rgba(14, 165, 233, 0.3);
  vertical-align: baseline;
}
.sm-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sm-alert {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.sm-toast {
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(16, 185, 129, 0.13);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: var(--dsw-alias-state-success-primary, #059669);
}

/* --- Avatars & Status Dots --- */
.sm-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  border: 1px solid transparent;
  user-select: none;
}
.sm-avatar-sm {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 11.5px;
}
.sm-avatar-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 1.8px solid var(--sm-bg-sidebar);
  background: #10b981;
}
.sm-avatar-dot.offline {
  background: #94a3b8;
}
.sm-avatar-dot.err {
  background: #ef4444;
}
.sm-avatar-dot.live {
  background: var(--sm-accent);
  animation: sm-ring-pulse 1.5s infinite;
}

/* --- Left Sidebar Main View: Polished IM & Team Groups --- */
.sm-chat-shell {
  display: grid;
  grid-template-columns: 276px 1fr;
  height: 100%;
  min-height: 560px;
  overflow: hidden;
  position: relative;
}
@media (max-width: 860px) {
  .sm-chat-shell {
    grid-template-columns: 1fr;
  }
}
.sm-conv-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-sidebar);
  overflow: hidden;
}
.sm-conv-top {
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--sm-border-l1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sm-conv-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sm-conv-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.sm-group-drawer {
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-peer-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sm-peer-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  white-space: nowrap;
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l1);
  cursor: pointer;
}
.sm-conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-room-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.sm-room-item:hover {
  background: var(--sm-bg-layer2);
}
.sm-room-item.active {
  border-color: color-mix(in srgb, var(--sm-accent) 34%, transparent);
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(14, 165, 233, 0.11));
}
.sm-room-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sm-room-top-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.sm-room-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sm-fg-primary);
}
.sm-room-time {
  font-size: 10.5px;
  color: var(--sm-fg-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}
.sm-room-preview-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.sm-room-preview {
  font-size: 11.5px;
  color: var(--sm-fg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-room-preview.live {
  color: var(--sm-accent);
  font-weight: 500;
}

/* --- Right Chat Workspace (with optional Inspector Drawer) --- */
.sm-chat-stage {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.sm-chat-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  min-height: 520px;
  background: var(--sm-bg-base);
  overflow: hidden;
  position: relative;
}
.sm-chat-header {
  padding: 11px 18px;
  background: var(--sm-bg-layer1);
  border-bottom: 1px solid var(--sm-border-l1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.sm-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 240px;
}
.sm-header-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.sm-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sm-member-tag {
  display: inline-flex;
  align-items: center;
  gap: 4.5px;
  padding: 2px 8.5px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
  color: var(--sm-fg-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.sm-member-tag.moderator {
  background: rgba(245, 158, 11, 0.13);
  border-color: rgba(245, 158, 11, 0.4);
  color: #d97706;
  font-weight: 600;
}
.sm-member-tag:hover:not(:disabled) {
  border-color: var(--sm-accent);
}
.sm-member-tag.busy {
  border-color: color-mix(in srgb, var(--sm-accent) 55%, transparent);
}

/* --- Live Multi-Sandbox Collaboration Topology Strip --- */
.sm-topology-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 7px 18px;
  background: color-mix(in srgb, var(--sm-accent) 7%, var(--sm-bg-layer1));
  border-bottom: 1px solid color-mix(in srgb, var(--sm-accent) 22%, var(--sm-border-l1));
  font-size: 11.5px;
  color: var(--sm-fg-primary);
}
.sm-topo-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--sm-accent);
  white-space: nowrap;
}
.sm-topo-flow {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sm-topo-node {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--sm-bg-layer1);
  border: 1px solid color-mix(in srgb, var(--sm-accent) 34%, var(--sm-border-l1));
  font-weight: 500;
}
.sm-topo-edge {
  color: var(--sm-accent);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  opacity: 0.85;
}

/* --- Message Stream --- */
.sm-messages {
  flex: 1;
  padding: 16px 20px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sm-topic-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  align-self: stretch;
  margin: 6px 0;
  font-size: 11px;
  color: var(--sm-fg-secondary);
}
.sm-topic-divider::before,
.sm-topic-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--sm-border-l1);
}
.sm-system-pill {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--sm-fg-secondary);
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
  max-width: 90%;
  text-align: center;
}

/* --- Collapsible Collaboration / Delegation Group --- */
.sm-collab-group {
  align-self: flex-start;
  width: min(88%, 720px);
  border-radius: 10px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  overflow: hidden;
}
.sm-collab-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--sm-fg-primary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}
.sm-collab-toggle:hover {
  background: var(--sm-bg-layer2);
}
.sm-collab-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.sm-collab-preview {
  color: var(--sm-fg-secondary);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-collab-steps {
  border-top: 1px solid var(--sm-border-l1);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--sm-bg-base);
}
.sm-collab-step {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
}
.sm-collab-step.dispatch {
  border-left: 2.5px solid #f59e0b;
}
.sm-collab-step.report {
  border-left: 2.5px solid #8b5cf6;
}
.sm-collab-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--sm-fg-secondary);
}

/* --- Typing / Live Indicators --- */
@keyframes sm-dot-bounce {
  0%, 80%, 100% { transform: translateY(0) scale(0.8); opacity: 0.4; }
  40% { transform: translateY(-3px) scale(1.05); opacity: 1; }
}
@keyframes sm-ring-pulse {
  0% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.55); }
  70% { box-shadow: 0 0 0 5px rgba(14, 165, 233, 0); }
  100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0); }
}
.sm-dot-live {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--sm-accent, var(--dsw-alias-link, #0ea5e9));
  animation: sm-ring-pulse 1.5s infinite;
  flex-shrink: 0;
}
.sm-typing-bubble {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 13px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--sm-accent) 8%, var(--sm-bg-layer1));
  border: 1px dashed color-mix(in srgb, var(--sm-accent) 42%, transparent);
  color: var(--sm-fg-secondary);
  font-size: 12px;
  max-width: 82%;
}
.sm-typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 12px;
}
.sm-typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--sm-accent);
  animation: sm-dot-bounce 1.2s infinite ease-in-out;
}
.sm-typing-dot:nth-child(2) { animation-delay: 0.16s; }
.sm-typing-dot:nth-child(3) { animation-delay: 0.32s; }

/* --- Chat Message Bubbles --- */
.sm-msg {
  position: relative;
  max-width: 84%;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l1);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  align-self: flex-start;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
.sm-msg.self {
  align-self: flex-end;
  border-color: color-mix(in srgb, var(--sm-accent) 32%, var(--sm-border-l1));
  background: var(--sm-bg-bubble-self);
}
.sm-msg.agent {
  border-left: 3px solid #8b5cf6;
}
.sm-msg.moderator-agent {
  border-left: 3px solid #f59e0b;
}
.sm-msg-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--sm-fg-secondary);
}
.sm-msg-author {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--sm-fg-primary);
}
.sm-msg-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.14s ease;
}
.sm-msg:hover .sm-msg-actions,
.sm-msg:focus-within .sm-msg-actions {
  opacity: 1;
}
.sm-msg-act-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--sm-fg-secondary);
  font-size: 11px;
  cursor: pointer;
}
.sm-msg-act-btn:hover {
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-primary);
}

/* --- Rich Markdown Typography --- */
.sm-md {
  display: flex;
  flex-direction: column;
  gap: 7px;
  line-height: 1.58;
  word-break: break-word;
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
}
.sm-md-p {
  margin: 0;
}
.sm-md-h {
  margin: 4px 0 0;
  font-weight: 650;
  line-height: 1.35;
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
}
.sm-md-h1 { font-size: 15.5px; }
.sm-md-h2 { font-size: 14.5px; }
.sm-md-h3 { font-size: 13.5px; }
.sm-md-h4 { font-size: 13px; }
.sm-md-hr {
  border: none;
  border-top: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.28)));
  margin: 4px 0;
}
.sm-md-quote {
  margin: 0;
  padding: 5px 10px;
  border-left: 3px solid var(--sm-accent, var(--dsw-alias-link, #0284c7));
  background: color-mix(in srgb, var(--sm-accent, #0284c7) 6%, transparent);
  border-radius: 0 6px 6px 0;
  color: var(--sm-fg-secondary, var(--dsw-alias-label-secondary, #475569));
}
.sm-md-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sm-md-inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--sm-bg-code, var(--dsw-alias-markdown-code-block, rgba(148, 163, 184, 0.16)));
  border: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.22)));
}
.sm-md-codeblock {
  border-radius: 8px;
  border: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.26)));
  background: var(--sm-bg-code, var(--dsw-alias-markdown-code-block, #f1f5f9));
  overflow: hidden;
}
.sm-md-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.2)));
  font-size: 11px;
  color: var(--sm-fg-secondary, var(--dsw-alias-label-secondary, #64748b));
}
.sm-md-code-lang {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-transform: lowercase;
}
.sm-md-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--sm-fg-secondary, var(--dsw-alias-label-secondary, #475569));
  font-size: 11px;
  cursor: pointer;
}
.sm-md-copy-btn:hover {
  background: rgba(148, 163, 184, 0.18);
  color: var(--sm-fg-primary, var(--dsw-alias-label-primary, #0f172a));
}
.sm-md-pre {
  margin: 0;
  padding: 9px 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.sm-md-table-wrap {
  width: 100%;
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.26)));
}
.sm-md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.sm-md-table th,
.sm-md-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--sm-border-l1, var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.2)));
  text-align: left;
  vertical-align: top;
}
.sm-md-table thead th {
  font-weight: 600;
  background: var(--sm-bg-layer2, var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.1)));
  white-space: nowrap;
}
.sm-md-table tbody tr:last-child td {
  border-bottom: none;
}
.sm-md-link {
  color: var(--sm-accent, var(--dsw-alias-link, #0284c7));
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* --- File Attachment Card & Preview Modal --- */
.sm-file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
  font-size: 12px;
}
.sm-file-card-info {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex: 1 1 180px;
}
.sm-file-icon-box {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--sm-accent) 14%, transparent);
  color: var(--sm-accent);
  flex-shrink: 0;
}
.sm-file-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.sm-file-name {
  font-weight: 600;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-file-sub {
  font-size: 11px;
  color: var(--sm-fg-secondary);
}
.sm-file-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.sm-preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.54);
  backdrop-filter: blur(2px);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.sm-preview-modal {
  width: min(840px, 94vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--sm-border-l2);
  background: var(--sm-bg-layer1);
  color: var(--sm-fg-primary);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.sm-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sm-border-l1);
}
.sm-preview-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--sm-bg-base);
}
.sm-preview-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.sm-preview-img {
  max-width: 100%;
  max-height: 66vh;
  border-radius: 8px;
  display: block;
  margin: 0 auto;
}

/* --- Right Room Inspector & Shared Files Drawer --- */
.sm-detail-drawer {
  width: 288px;
  flex-shrink: 0;
  border-left: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.16s ease;
}
.sm-detail-drawer.is-wide {
  width: 356px;
  max-width: 44vw;
}
@media (max-width: 980px) {
  .sm-detail-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    box-shadow: -8px 0 28px rgba(0, 0, 0, 0.16);
  }
  .sm-detail-drawer.is-wide {
    width: min(356px, 92vw);
    max-width: 92vw;
  }
}
.sm-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sm-border-l1);
  font-size: 13px;
  font-weight: 600;
}
.sm-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sm-drawer-body.is-tasks {
  padding: 12px;
  gap: 10px;
}
.sm-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-drawer-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--sm-fg-secondary);
}
.sm-topic-jump-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: 7px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-base);
  color: var(--sm-fg-primary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.sm-topic-jump-btn:hover {
  border-color: var(--sm-accent);
}

/* --- Drag & Drop Overlay --- */
.sm-drop-overlay {
  position: absolute;
  inset: 10px;
  border-radius: 12px;
  border: 2px dashed var(--sm-accent);
  background: color-mix(in srgb, var(--sm-accent) 10%, var(--sm-bg-layer1));
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--sm-accent);
  pointer-events: none;
}

/* --- Unified Composer with @ / # / Upload & Reply Bar --- */
.sm-composer-wrap {
  position: relative;
  padding: 10px 18px 14px;
  background: var(--sm-bg-layer1);
  border-top: 1px solid var(--sm-border-l1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-reply-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border-left: 3px solid var(--sm-accent);
  background: var(--sm-bg-layer2);
  font-size: 11.5px;
  color: var(--sm-fg-secondary);
}
.sm-popover {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: calc(100% - 4px);
  max-height: 224px;
  overflow-y: auto;
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l2);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  padding: 6px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sm-popover-header {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sm-fg-secondary);
}
.sm-popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--sm-fg-primary);
  text-align: left;
}
.sm-popover-item:hover, .sm-popover-item.active {
  background: color-mix(in srgb, var(--sm-accent) 14%, transparent);
}
.sm-attached-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sm-attached-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  background: rgba(14, 165, 233, 0.13);
  color: var(--sm-accent);
  border: 1px solid rgba(14, 165, 233, 0.3);
}
.sm-composer-box {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid var(--sm-border-l2);
  background: var(--sm-bg-input);
  transition: border-color 0.14s ease;
}
.sm-composer-box:focus-within {
  border-color: var(--sm-accent);
}
.sm-composer-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--sm-fg-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.48;
  padding: 4px 6px;
  outline: none;
  resize: none;
  max-height: 140px;
}
.sm-trigger-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--sm-fg-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s ease;
}
.sm-trigger-btn:hover, .sm-trigger-btn.active {
  background: color-mix(in srgb, var(--sm-accent) 14%, transparent);
  color: var(--sm-accent);
  border-color: color-mix(in srgb, var(--sm-accent) 32%, transparent);
}

/* --- Native DSH Main-Chat Tool Call & Incoming Wake Cards --- */
.sm-tool-card {
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.26));
  background: var(--dsw-alias-bg-layer-1, rgba(148, 163, 184, 0.05));
  color: var(--dsw-alias-label-primary, #0f172a);
  overflow: hidden;
  font-size: 12.5px;
  margin: 2px 0;
}
.sm-tool-card.running {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #0284c7) 42%, transparent);
}
.sm-tool-card.error {
  border-color: rgba(239, 68, 68, 0.36);
}
.sm-tool-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 11px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.sm-tool-head:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.1));
}
.sm-tool-head-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.sm-tool-icon {
  display: inline-flex;
  color: var(--dsw-alias-state-business-primary, var(--dsw-alias-link, #0284c7));
  flex-shrink: 0;
}
.sm-tool-title {
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.sm-tool-target {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(139, 92, 246, 0.14);
  color: #8b5cf6;
  white-space: nowrap;
  flex-shrink: 0;
}
.sm-tool-preview {
  color: var(--dsw-alias-label-secondary, #64748b);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-tool-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.sm-tool-status.running { color: var(--dsw-alias-state-business-primary, #0284c7); }
.sm-tool-status.ok { color: var(--dsw-alias-state-success-primary, #059669); }
.sm-tool-status.error { color: var(--dsw-alias-state-error-primary, #dc2626); }
.sm-tool-body {
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.22));
  padding: 10px 12px;
  background: var(--dsw-alias-bg-base, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sm-tool-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-tool-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #64748b);
}
.sm-tool-files {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.sm-tool-roster {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sm-tool-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #64748b);
}
.sm-tool-meta-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #0f172a);
}
.sm-tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1.5px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 550;
  background: var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.14));
  color: var(--dsw-alias-label-secondary, #475569);
  white-space: nowrap;
}
.sm-tool-pill.ok {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}
.sm-tool-pill.info {
  background: rgba(14, 165, 233, 0.14);
  color: #0284c7;
}
.sm-tool-pill.review {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}
.sm-tool-pill.warn {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}
.sm-tool-pill.err {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}
.sm-tool-pill-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  opacity: 0.78;
}
.sm-tool-task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sm-tool-task-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.22));
  background: var(--dsw-alias-bg-layer-1, rgba(148, 163, 184, 0.05));
}
.sm-tool-task-item.is-done {
  opacity: 0.9;
}
.sm-tool-task-item.is-blocked {
  border-color: rgba(239, 68, 68, 0.34);
}
.sm-tool-task-item.is-approval {
  border-color: rgba(245, 158, 11, 0.4);
}
.sm-tool-task-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sm-tool-task-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}
.sm-tool-task-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--dsw-alias-label-secondary, #94a3b8);
}
.sm-tool-task-dot.todo { border: 1.5px solid var(--dsw-alias-label-secondary, #64748b); background: transparent; }
.sm-tool-task-dot.in_progress { background: #0284c7; }
.sm-tool-task-dot.in_review { background: #8b5cf6; }
.sm-tool-task-dot.blocked { background: #ef4444; }
.sm-tool-task-dot.done { background: #10b981; }
.sm-tool-task-dot.cancelled { background: #94a3b8; opacity: 0.5; }
.sm-tool-task-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #0f172a);
  word-break: break-word;
}
.sm-tool-task-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #475569);
  padding-left: 13px;
}
.sm-tool-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid rgba(14, 165, 233, 0.28);
  background: rgba(14, 165, 233, 0.1);
  color: var(--dsw-alias-link, #0284c7);
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-tool-file-btn:hover {
  background: rgba(14, 165, 233, 0.18);
  border-color: rgba(14, 165, 233, 0.45);
}
.sm-tool-file-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #64748b);
  word-break: break-all;
}
.sm-tool-approval-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid rgba(245, 158, 11, 0.36);
  background: color-mix(in srgb, #f59e0b 6%, var(--dsw-alias-bg-layer-1, transparent));
}
.sm-tool-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #64748b);
}
.sm-tool-error-box {
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid rgba(239, 68, 68, 0.34);
  background: rgba(239, 68, 68, 0.08);
  color: var(--dsw-alias-state-error-primary, #dc2626);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.sm-tool-progress-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.18));
  overflow: hidden;
  margin-top: 2px;
}
.sm-tool-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #0284c7);
}
.sm-tool-progress-fill.is-complete {
  background: #10b981;
}
.sm-tool-target.status-done { background: rgba(16, 185, 129, 0.14); color: #059669; }
.sm-tool-target.status-in_progress { background: rgba(14, 165, 233, 0.14); color: #0284c7; }
.sm-tool-target.status-in_review { background: rgba(139, 92, 246, 0.14); color: #7c3aed; }
.sm-tool-target.status-blocked { background: rgba(239, 68, 68, 0.14); color: #dc2626; }
.sm-tool-target.status-cancelled { background: rgba(148, 163, 184, 0.16); color: #64748b; }
.sm-tool-target.status-todo { background: rgba(148, 163, 184, 0.16); color: #64748b; }
.sm-wake-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.28));
  background: var(--dsw-alias-bg-layer-1, rgba(148, 163, 184, 0.06));
  color: var(--dsw-alias-label-primary, inherit);
}
.sm-wake-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.sm-wake-body {
  font-size: 13px;
}
.sm-wake-raw {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--dsw-alias-markdown-code-block, rgba(148, 163, 184, 0.12));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}

/* --- Action variants, badges & confirmations --- */
.sm-btn-sm {
  padding: 3.5px 8.5px;
  font-size: 11.5px;
}
.sm-btn-danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.36);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.sm-btn.sm-btn-danger:hover:not(:disabled) {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}
.sm-badge-ok {
  background: rgba(16, 185, 129, 0.15);
  color: var(--dsw-alias-state-success-primary, #059669);
}
.sm-badge-warn {
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
}
.sm-badge-err {
  background: rgba(239, 68, 68, 0.13);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.sm-confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.28);
  font-size: 12px;
  color: var(--sm-fg-primary);
}
.sm-unpaired-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.32);
  font-size: 12.5px;
  color: var(--sm-fg-primary);
}
.sm-onboarding-card {
  margin: auto;
  width: 100%;
  max-width: 590px;
  padding: 24px 26px;
  border-radius: 14px;
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l1);
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.07);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sm-pair-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 9px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
}
.sm-pair-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
}
.sm-invite-expiry {
  font-size: 11px;
  font-weight: 500;
  color: var(--sm-fg-secondary);
}

/* --- Settings View: Pairing, Presets & Node Config --- */
.sm-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
  max-width: 860px;
}
.sm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.sm-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.sm-subtitle {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--sm-fg-secondary);
  line-height: 1.48;
}
.sm-card {
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l1);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sm-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sm-template-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11.5px;
  color: var(--sm-fg-secondary);
}
.sm-template-pill {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--sm-border-l2);
  background: var(--sm-bg-base);
  color: var(--sm-fg-primary);
  font-size: 11.5px;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.sm-template-pill:hover {
  border-color: var(--sm-accent);
  background: color-mix(in srgb, var(--sm-accent) 10%, transparent);
}
.sm-invite-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-invite-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.sm-invite-label {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 130px;
  color: var(--sm-fg-secondary);
}
.sm-invite-code {
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--sm-bg-input);
  border: 1px solid var(--sm-border-l2);
  color: var(--sm-fg-primary);
  outline: none;
  cursor: text;
}
.sm-invite-code:focus {
  border-color: var(--sm-accent);
}
.sm-peer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
}
.sm-advanced-details {
  font-size: 12px;
  color: var(--sm-fg-secondary);
}
.sm-advanced-details summary {
  cursor: pointer;
  user-select: none;
  font-weight: 500;
}
.sm-advanced-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* --- Task Board, Human Approval Gates & Role SOP --- */
.sm-nav-badge-dot.warn {
  background: #f59e0b;
  box-shadow: 0 0 0 2px var(--dsw-specific-sidebar-fill, #ffffff);
}
.sm-badge-approval {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.38);
  font-weight: 600;
}
.sm-approval-card {
  border-radius: 11px;
  border: 1px solid rgba(245, 158, 11, 0.42);
  background: color-mix(in srgb, #f59e0b 6%, var(--sm-bg-layer1));
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 680px;
}
.sm-approval-card.approved {
  border-color: rgba(16, 185, 129, 0.42);
  background: color-mix(in srgb, #10b981 6%, var(--sm-bg-layer1));
}
.sm-approval-card.rejected {
  border-color: rgba(239, 68, 68, 0.4);
  background: color-mix(in srgb, #ef4444 5%, var(--sm-bg-layer1));
}
.sm-approval-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sm-approval-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 650;
  color: var(--sm-fg-primary);
}
.sm-approval-body {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--sm-fg-primary);
}
.sm-approval-actions {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 4px;
  border-top: 1px dashed var(--sm-border-l1);
}
.sm-approval-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sm-btn-approve {
  background: #10b981;
  color: #ffffff;
  border-color: #10b981;
}
.sm-btn-approve:hover:not(:disabled) {
  background: #059669;
  border-color: #059669;
}
.sm-approval-decided {
  font-size: 12px;
  color: var(--sm-fg-secondary);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sm-task-progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--sm-border-l1);
}
.sm-task-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.sm-task-progress-nums {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-weight: 600;
  color: var(--sm-fg-primary);
}
.sm-task-progress-pct {
  font-size: 11px;
  font-weight: 500;
  color: var(--sm-fg-secondary);
}
.sm-task-progress-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--sm-bg-layer2);
  overflow: hidden;
}
.sm-task-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--sm-accent);
  transition: width 0.22s ease;
}
.sm-task-progress-fill.is-complete {
  background: #10b981;
}
.sm-task-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.sm-task-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--sm-bg-layer2);
  border: 1px solid var(--sm-border-l1);
}
.sm-task-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sm-fg-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.sm-task-tab:hover {
  color: var(--sm-fg-primary);
}
.sm-task-tab.is-active {
  background: var(--sm-bg-layer1);
  color: var(--sm-fg-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.sm-task-tab-count {
  font-size: 10px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}
.sm-task-scope-btn {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--sm-border-l1);
  background: transparent;
  color: var(--sm-fg-secondary);
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}
.sm-task-scope-btn:hover {
  border-color: var(--sm-border-l2);
  color: var(--sm-fg-primary);
  background: var(--sm-bg-layer2);
}
.sm-task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sm-task-group-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  margin-top: 2px;
  border: 1px dashed var(--sm-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--sm-fg-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.sm-task-group-toggle:hover {
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-primary);
}
.sm-task-group-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sm-task-card {
  display: flex;
  flex-direction: column;
  border-radius: 9px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
}
.sm-task-card:hover {
  border-color: var(--sm-border-l2);
}
.sm-task-card.is-expanded {
  border-color: color-mix(in srgb, var(--sm-accent) 42%, var(--sm-border-l2));
  background: var(--sm-bg-layer1);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}
.sm-task-card.is-approval-pending {
  border-color: rgba(245, 158, 11, 0.52);
  background: color-mix(in srgb, rgba(245, 158, 11, 0.08) 100%, var(--sm-bg-layer1));
}
.sm-task-card.is-blocked {
  border-color: rgba(239, 68, 68, 0.42);
}
.sm-task-card.is-done:not(.is-expanded) {
  background: var(--sm-bg-layer2);
  opacity: 0.88;
}
.sm-task-card.is-done:not(.is-expanded):hover {
  opacity: 1;
}
.sm-task-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.sm-task-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  margin-top: 4px;
}
.sm-task-dot.todo {
  border: 1.5px solid var(--sm-fg-secondary);
  background: transparent;
  opacity: 0.7;
}
.sm-task-dot.in_progress {
  background: var(--sm-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sm-accent) 18%, transparent);
}
.sm-task-dot.in_review {
  background: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
}
.sm-task-dot.blocked {
  background: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16);
}
.sm-task-dot.done {
  background: #10b981;
}
.sm-task-dot.cancelled {
  background: var(--sm-fg-secondary);
  opacity: 0.45;
}
.sm-task-dot.approval {
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.22);
}
.sm-task-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-task-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sm-fg-primary);
  line-height: 1.38;
  word-break: break-word;
}
.sm-task-card:not(.is-expanded) .sm-task-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sm-task-card.is-done:not(.is-expanded) .sm-task-title {
  font-weight: 500;
  color: var(--sm-fg-secondary);
}
.sm-task-card.is-cancelled .sm-task-title {
  text-decoration: line-through;
  opacity: 0.7;
}
.sm-task-chevron {
  flex-shrink: 0;
  color: var(--sm-fg-secondary);
  opacity: 0.65;
  margin-top: 2px;
}
.sm-task-card:hover .sm-task-chevron,
.sm-task-card.is-expanded .sm-task-chevron {
  opacity: 1;
  color: var(--sm-fg-primary);
}
.sm-task-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--sm-fg-secondary);
}
.sm-task-assignee {
  font-size: 11px;
  font-weight: 500;
  color: var(--sm-fg-secondary);
}
.sm-task-status {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.45;
}
.sm-task-status.todo {
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-secondary);
}
.sm-task-status.in_progress {
  background: color-mix(in srgb, var(--sm-accent) 14%, transparent);
  color: var(--sm-accent);
}
.sm-task-status.in_review {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}
.sm-task-status.blocked {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}
.sm-task-status.done {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}
.sm-task-status.cancelled {
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-secondary);
  text-decoration: line-through;
}
.sm-task-priority {
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-secondary);
}
.sm-task-priority.high, .sm-task-priority.urgent {
  background: rgba(239, 68, 68, 0.11);
  color: #dc2626;
}
.sm-task-pill-muted {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-secondary);
  font-variant-numeric: tabular-nums;
}
.sm-task-card.is-done:not(.is-expanded) .sm-task-pill-muted {
  background: var(--sm-bg-layer1);
}
.sm-task-pill-wait {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}
.sm-task-approval-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 9px 26px;
}
.sm-task-approval-preview {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--sm-fg-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sm-task-details {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 9px 10px 10px;
  border-top: 1px solid var(--sm-border-l1);
  background: color-mix(in srgb, var(--sm-bg-layer2) 48%, var(--sm-bg-layer1));
  border-radius: 0 0 8px 8px;
}
.sm-task-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--sm-fg-secondary);
}
.sm-task-status-select {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--sm-border-l2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  font-family: inherit;
}
.sm-task-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-task-section-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--sm-fg-secondary);
  letter-spacing: 0.02em;
}
.sm-task-dep-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sm-task-dep-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--sm-bg-layer1);
  border: 1px solid var(--sm-border-l1);
  color: var(--sm-fg-secondary);
}
.sm-task-dep-chip.is-met {
  color: #059669;
  border-color: rgba(16, 185, 129, 0.28);
}
.sm-task-dep-chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-task-md-box {
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--sm-fg-primary);
  max-height: 185px;
  overflow-y: auto;
  word-break: break-word;
}
.sm-task-md-box p {
  margin: 0 0 6px;
}
.sm-task-md-box p:last-child {
  margin-bottom: 0;
}
.sm-task-md-box ul,
.sm-task-md-box ol {
  margin: 4px 0;
  padding-left: 16px;
}
.sm-task-spec-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--sm-accent);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  align-self: flex-start;
}
.sm-task-spec-toggle:hover {
  text-decoration: underline;
}
.sm-task-artifact-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-task-artifact-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--sm-border-l1);
  background: var(--sm-bg-layer1);
  color: var(--sm-fg-primary);
  font-size: 11px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
  font-family: inherit;
}
.sm-task-artifact-row:hover {
  border-color: var(--sm-accent);
  background: var(--sm-bg-layer2);
}
.sm-task-artifact-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  background: var(--sm-bg-layer2);
  color: var(--sm-fg-secondary);
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-task-artifact-text {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: var(--sm-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-task-artifact-action {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--sm-fg-secondary);
  opacity: 0.72;
}
.sm-task-artifact-more {
  align-self: flex-start;
  padding: 2px 6px;
  margin-top: 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--sm-accent);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.sm-task-artifact-more:hover {
  background: var(--sm-bg-layer1);
}
.sm-task-approval-record {
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 11px;
  line-height: 1.45;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--sm-fg-primary);
}
.sm-task-approval-record.is-rejected {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
}
.sm-task-empty-state {
  padding: 16px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--sm-fg-secondary);
  opacity: 0.82;
  line-height: 1.5;
}
.sm-task-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border-radius: 9px;
  border: 1px solid var(--sm-border-l2);
  background: var(--sm-bg-layer1);
}
.sm-sop-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 78px;
  resize: vertical;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--sm-border-l2);
  background: var(--sm-bg-input);
  color: var(--sm-fg-primary);
  outline: none;
}
.sm-sop-textarea:focus {
  border-color: var(--sm-accent);
}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {}
  const existing = document.head.querySelector('style[data-plugin="sandbox-mesh"]')
  if (existing) {
    return () => { existing.remove() }
  }
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-plugin', 'sandbox-mesh')
  styleEl.textContent = MESH_CSS
  document.head.appendChild(styleEl)
  return () => {
    styleEl.remove()
  }
}
