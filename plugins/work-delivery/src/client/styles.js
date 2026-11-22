export const STYLE_ATTR_PLUGIN = '@metis/work-delivery'

export const WORK_DELIVERY_CSS = `
.wd-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary, #111827);
  background: var(--dsw-alias-bg-base, transparent);
  font-family: inherit;
  font-size: 14px;
  box-sizing: border-box;
}

.wd-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 28px 44px;
}

.wd-container {
  max-width: 1220px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.wd-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.wd-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1 1 320px;
}

.wd-title-badge {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #6366f1 0%, #3b82f6 55%, #06b6d4 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
  flex: none;
}

.wd-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  line-height: 26px;
  color: var(--dsw-alias-label-primary, #111827);
}

.wd-subtitle {
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.wd-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.wd-kpi {
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.04));
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
  font-family: inherit;
  color: inherit;
}

.wd-kpi:hover {
  border-color: var(--dsw-alias-brand-primary, #6366f1);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.08));
}

.wd-kpi-label {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.wd-kpi-value {
  margin-top: 4px;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}

.wd-prompt-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.03));
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.wd-prompt-chip {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.24));
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, #111827);
  border-radius: 999px;
  padding: 4px 11px;
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.wd-prompt-chip:hover {
  border-color: var(--dsw-alias-brand-primary, #6366f1);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
}

.wd-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wd-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.06));
}

.wd-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: none;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.wd-tab:hover {
  color: var(--dsw-alias-label-primary, #111827);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
}

.wd-tab.active {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f46e5));
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.wd-tab-count {
  font-size: 11.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.18);
}

.wd-tab.active .wd-tab-count {
  background: rgba(255, 255, 255, 0.22);
}

.wd-card {
  border-radius: var(--dsw-radius-lg, 14px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.04));
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wd-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wd-card-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111827);
}

.wd-muted {
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-size: 13.5px;
  line-height: 20px;
  margin: 0;
}

.wd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms ease, filter 120ms ease;
}

.wd-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14));
}

.wd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wd-btn-sm {
  height: 30px;
  padding: 0 11px;
  font-size: 12.5px;
}

.wd-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f46e5));
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.wd-btn-emerald {
  border-color: transparent;
  background: #059669;
  color: #ffffff;
}

.wd-btn-emerald:hover:not(:disabled) {
  background: #047857;
}

.wd-btn-danger {
  color: #e11d48;
  border-color: rgba(225, 29, 72, 0.35);
  background: rgba(225, 29, 72, 0.06);
}

.wd-btn-danger:hover:not(:disabled) {
  background: rgba(225, 29, 72, 0.14);
}

.wd-input {
  height: 36px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.24));
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 13.5px;
  box-sizing: border-box;
  outline: none;
}

.wd-input:focus {
  border-color: var(--dsw-alias-brand-primary, #6366f1);
}

.wd-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wd-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wd-pill {
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.wd-pill.active {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f46e5));
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.wd-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}

.wd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.18));
  background: var(--dsw-alias-bg-base, rgba(128, 128, 128, 0.03));
}

.wd-task-wrap {
  border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.18));
  background: var(--dsw-alias-bg-base, rgba(128, 128, 128, 0.03));
  overflow: hidden;
}

.wd-task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
}

.wd-task-head:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.06));
}

.wd-task-detail {
  padding: 10px 14px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.14));
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #6b7280);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.wd-item-col {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wd-item-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #111827);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wd-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  color: var(--dsw-alias-label-primary, #111827);
  flex-shrink: 0;
}

.wd-badge-ok {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.wd-badge-warn {
  border-color: rgba(245, 158, 11, 0.38);
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.wd-badge-brand {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary, #4f46e5);
  color: #ffffff;
}

.wd-approval-row {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.08);
}

.wd-log-box {
  border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: rgba(0, 0, 0, 0.14);
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.wd-toast {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 9999;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  background: #065f46;
  color: #ecfdf5;
}

.wd-toast.err {
  background: #9f1239;
  color: #fff1f2;
}

/* Chat Tool Card */
.wd-tool-card {
  border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
  overflow: hidden;
  margin: 4px 0;
}

.wd-tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.wd-tool-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wd-tool-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111827);
  white-space: nowrap;
}

.wd-tool-preview {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wd-tool-body {
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {}
  const existing = document.head.querySelector(`style[data-plugin="${STYLE_ATTR_PLUGIN}"]`)
  if (existing) return () => {}
  const el = document.createElement('style')
  el.setAttribute('data-plugin', STYLE_ATTR_PLUGIN)
  el.textContent = WORK_DELIVERY_CSS
  document.head.appendChild(el)
  return () => {
    try { el.remove() } catch {}
  }
}
