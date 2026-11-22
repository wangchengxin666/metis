export const STYLE_ATTR_PLUGIN = '@metis/custom-theme'

export const SETTINGS_CSS = `
.ct-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 0 12px;
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
}

.ct-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}

.ct-header-text {
  flex: 1 1 280px;
  min-width: 0;
}

.ct-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--dsw-alias-label-primary, #111827);
}

.ct-subtitle {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.ct-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.ct-toast-wrap {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
}

.ct-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 240px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 11px 14px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #ffffff));
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  animation: ct-toast-in 160ms ease-out;
}

.ct-toast[data-kind='saved'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 40%, var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14)));
}

.ct-toast[data-kind='error'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 45%, var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14)));
}

.ct-toast-icon {
  flex: none;
  margin-top: 1px;
  color: var(--dsw-alias-state-success-primary, #16a34a);
}

.ct-toast[data-kind='error'] .ct-toast-icon {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.ct-toast-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ct-toast-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #111827);
}

.ct-toast-detail {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  word-break: break-word;
}

.ct-toast-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: -2px -4px 0 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer;
}

.ct-toast-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #111827);
}

@keyframes ct-toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ct-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  background: var(--dsw-alias-button-elevated-fill, transparent);
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, filter 120ms ease, border-color 120ms ease;
}

@media (hover: hover) {
  .ct-btn:not(.ct-btn-primary):hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  }
}

.ct-btn.ct-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb));
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base, #ffffff));
}

@media (hover: hover) {
  .ct-btn.ct-btn-primary:hover:not(:disabled) {
    background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb));
    color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base, #ffffff));
    filter: brightness(0.9);
  }
}

.ct-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ct-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
}

.ct-switch-label {
  font-size: 13.5px;
  font-weight: 500;
}

.ct-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-state-idle-primary, #9ca3af);
  cursor: pointer;
  transition: background-color 140ms ease;
}

.ct-toggle[aria-checked='true'] {
  background: var(--dsw-alias-state-business-primary, #2563eb);
}

.ct-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 140ms ease;
}

.ct-toggle[aria-checked='true'] .ct-toggle-thumb {
  transform: translateX(18px);
}

.ct-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ct-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111827);
}

.ct-section-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.ct-mode-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ct-mode-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.ct-mode-card[aria-pressed='true'] {
  border-color: var(--dsw-alias-border-selected, #2563eb);
  background: var(--dsw-alias-bg-module-platform, rgba(37, 99, 235, 0.08));
}

.ct-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 10px;
}

.ct-preset-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

@media (hover: hover) {
  .ct-preset-card:hover {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
  }
}

.ct-preset-card[aria-pressed='true'] {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary, #2563eb);
}

.ct-preset-swatches {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.ct-swatch-half {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 3px 5px;
  border-radius: 6px;
  border: 1px solid rgba(128, 128, 128, 0.25);
}

.ct-swatch-bar {
  width: 8px;
  height: 100%;
  border-radius: 3px;
}

.ct-swatch-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-left: auto;
}

.ct-preset-name {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 18px;
}

.ct-token-group {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 12px);
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, transparent);
}

.ct-token-group-head {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #6b7280);
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.02));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
}

.ct-token-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.3fr) minmax(135px, 1fr) minmax(135px, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
}

.ct-token-row:last-child {
  border-bottom: 0;
}

.ct-token-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ct-token-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #111827);
}

.ct-token-var {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ct-color-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ct-color-picker {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16));
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.ct-input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
  background: var(--dsw-specific-input-major, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.ct-input-sans {
  font-family: inherit;
}

.ct-custom-row {
  display: grid;
  grid-template-columns: minmax(130px, 1.2fr) minmax(110px, 1fr) minmax(110px, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
}

.ct-custom-row:last-child {
  border-bottom: 0;
}

.ct-brand-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}

.ct-brand-preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-specific-sidebar-fill, #f3f4f6);
  width: fit-content;
}

.ct-textarea {
  width: 100%;
  min-height: 76px;
  padding: 8px;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
  background: var(--dsw-specific-input-major, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  resize: vertical;
}

.ct-error-text {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.ct-brand-name-slot {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-brand-text, var(--dsw-alias-label-primary, currentColor));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 640px) {
  .ct-token-row,
  .ct-custom-row {
    grid-template-columns: 1fr;
  }
}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head) {
    return () => {}
  }
  const existing = document.head.querySelector(`style[data-plugin="${STYLE_ATTR_PLUGIN}"]`)
  if (existing) {
    existing.textContent = SETTINGS_CSS
    return () => { existing.remove() }
  }
  const el = document.createElement('style')
  el.setAttribute('data-plugin', STYLE_ATTR_PLUGIN)
  el.textContent = SETTINGS_CSS
  document.head.appendChild(el)
  return () => { el.remove() }
}
