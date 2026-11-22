export const STYLE_ATTR_PLUGIN = '@metis/sandbox-memory'

export const MEMORY_CSS = `
.smem-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary, #111827);
  background: var(--dsw-alias-bg-base, transparent);
  font-family: inherit;
  box-sizing: border-box;
}

.smem-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 36px;
}

.smem-container {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.smem-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.smem-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1 1 320px;
}

.smem-title-badge {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 55%, #8b5cf6 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
  flex: none;
}

.smem-title {
  margin: 0;
  font-size: 19px;
  font-weight: 650;
  line-height: 25px;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-subtitle {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.smem-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms ease, border-color 120ms ease, filter 120ms ease;
}

.smem-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
}

.smem-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.smem-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f46e5));
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}

.smem-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f46e5));
  filter: brightness(0.92);
}

.smem-btn-danger {
  color: var(--dsw-alias-state-error-primary, #dc2626);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 35%, transparent);
}

.smem-btn-sm {
  height: 26px;
  padding: 0 8px;
  font-size: 11.5px;
  border-radius: 6px;
}

.smem-btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
}

.smem-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.smem-stat-card {
  padding: 12px 14px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.03));
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.smem-stat-label {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-stat-value {
  font-size: 20px;
  font-weight: 650;
  line-height: 26px;
  color: var(--dsw-alias-label-primary, #111827);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.smem-stat-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-budget-bar {
  height: 5px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.16));
  overflow: hidden;
  margin-top: 4px;
}

.smem-budget-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #4f46e5);
  transition: width 180ms ease;
}

.smem-budget-fill.warn {
  background: #f59e0b;
}

.smem-budget-fill.high {
  background: #ef4444;
}

.smem-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  padding-bottom: 0;
}

.smem-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.smem-tab:hover {
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-tab.active {
  color: var(--dsw-alias-brand-primary, #4f46e5);
  border-bottom-color: var(--dsw-alias-brand-primary, #4f46e5);
  font-weight: 600;
}

.smem-tab-count {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.smem-search-wrap {
  position: relative;
  flex: 1 1 240px;
  min-width: 180px;
}

.smem-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  pointer-events: none;
}

.smem-input,
.smem-select,
.smem-textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #ffffff));
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 12.5px;
}

.smem-input {
  height: 32px;
  padding: 0 10px;
}

.smem-input.with-icon {
  padding-left: 30px;
}

.smem-select {
  height: 32px;
  padding: 0 8px;
  width: auto;
  min-width: 112px;
}

.smem-textarea {
  min-height: 110px;
  padding: 9px 10px;
  resize: vertical;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.smem-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.smem-pill {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.smem-pill.active {
  border-color: var(--dsw-alias-brand-primary, #4f46e5);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f46e5) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4f46e5);
  font-weight: 600;
}

.smem-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.smem-card {
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.025));
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 120ms ease;
}

.smem-card.disabled {
  opacity: 0.62;
}

.smem-card.pinned {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f46e5) 38%, var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16)));
}

.smem-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.smem-card-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}

.smem-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111827);
  word-break: break-word;
}

.smem-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-badge.cat-preference { background: rgba(139, 92, 246, 0.14); color: #7c3aed; }
.smem-badge.cat-project { background: rgba(14, 165, 233, 0.14); color: #0284c7; }
.smem-badge.cat-environment { background: rgba(16, 185, 129, 0.14); color: #059669; }
.smem-badge.cat-workflow { background: rgba(59, 130, 246, 0.14); color: #2563eb; }
.smem-badge.cat-pitfall { background: rgba(245, 158, 11, 0.16); color: #d97706; }
.smem-badge.cat-fact { background: rgba(107, 114, 128, 0.14); color: #4b5563; }

.smem-badge.src-auto { background: rgba(16, 185, 129, 0.14); color: #059669; }
.smem-badge.src-agent { background: rgba(99, 102, 241, 0.14); color: #4f46e5; }
.smem-badge.src-manual { background: rgba(107, 114, 128, 0.13); color: var(--dsw-alias-label-secondary, #6b7280); }
.smem-badge.pin { background: rgba(245, 158, 11, 0.15); color: #d97706; }

.smem-card-summary {
  margin: 0;
  font-size: 12.5px;
  line-height: 19px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  word-break: break-word;
}

.smem-card-content {
  margin: 2px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.07));
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.12));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, #9ca3af);
}

.smem-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.smem-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-card-ops {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.smem-empty {
  padding: 36px 20px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-empty h3 {
  margin: 0;
  font-size: 14.5px;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-empty p {
  margin: 0;
  max-width: 460px;
  font-size: 12.5px;
  line-height: 19px;
}

.smem-form-box {
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4f46e5) 35%, var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2)));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.03));
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.smem-form-grid {
  display: grid;
  grid-template-columns: 1fr 160px;
  gap: 10px;
}

.smem-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.smem-field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.smem-check-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-env-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.smem-env-card {
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.025));
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.smem-env-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-env-card-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.smem-kv-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.smem-kv-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.08));
}

.smem-kv-row:last-child {
  border-bottom: 0;
}

.smem-kv-key {
  color: var(--dsw-alias-label-secondary, #6b7280);
  flex: none;
}

.smem-kv-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary, #111827);
  word-break: break-all;
  text-align: right;
}

.smem-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.smem-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 7px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9ca3af;
}

.smem-dot.running { background: #10b981; }
.smem-dot.fatal, .smem-dot.stopped { background: #ef4444; }

.smem-preview-box {
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.025));
  overflow: hidden;
}

.smem-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.1));
  font-size: 12.5px;
  font-weight: 600;
}

.smem-preview-pre {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-policy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.14));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.02));
}

.smem-policy-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.smem-policy-title {
  font-size: 13px;
  font-weight: 550;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-policy-desc {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.smem-toggle {
  position: relative;
  flex: none;
  width: 38px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-state-idle-primary, #9ca3af);
  cursor: pointer;
  transition: background-color 140ms ease;
}

.smem-toggle[aria-checked='true'] {
  background: var(--dsw-alias-brand-primary, #4f46e5);
}

.smem-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
  transition: transform 140ms ease;
}

.smem-toggle[aria-checked='true'] .smem-toggle-thumb {
  transform: translateX(16px);
}

.smem-toast {
  padding: 9px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4f46e5) 35%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f46e5) 10%, var(--dsw-alias-bg-layer-1, #ffffff));
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-toast.error {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 10%, var(--dsw-alias-bg-layer-1, #ffffff));
}

/* Native DSH Chat Tool Card (tool.call.toolview) */
.smem-tool-card {
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.18));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.04));
  overflow: hidden;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary, #111827);
}

.smem-tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 11px;
  cursor: pointer;
  user-select: none;
}

.smem-tool-head-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1 1 auto;
}

.smem-tool-title {
  font-weight: 600;
  white-space: nowrap;
}

.smem-tool-preview {
  color: var(--dsw-alias-label-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smem-tool-body {
  padding: 8px 11px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.12));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-secondary, #4b5563);
  max-height: 220px;
  overflow-y: auto;
}

.smem-settings-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 12px;
  color: var(--dsw-alias-label-primary, #111827);
}

@media (max-width: 760px) {
  .smem-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .smem-env-grid { grid-template-columns: 1fr; }
  .smem-form-grid { grid-template-columns: 1fr; }
}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head) {
    return () => {}
  }
  const existing = document.head.querySelector(`style[data-plugin="${STYLE_ATTR_PLUGIN}"]`)
  if (existing) {
    existing.textContent = MEMORY_CSS
    return () => { existing.remove() }
  }
  const el = document.createElement('style')
  el.setAttribute('data-plugin', STYLE_ATTR_PLUGIN)
  el.textContent = MEMORY_CSS
  document.head.appendChild(el)
  return () => { el.remove() }
}
