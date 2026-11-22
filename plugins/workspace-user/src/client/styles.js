export const STYLE_ATTR_PLUGIN = '@metis/workspace-user'

export const LAUNCHER_CSS = `
.wu-root {
  position: relative;
  flex: 1;
  min-width: 0;
}

.wu-root[data-collapsed='true'] {
  flex: none;
  width: 36px;
}

.wu-trigger {
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 5px 8px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 10px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

@media (hover: hover) {
  .wu-trigger:hover {
    background-color: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  }
}

.wu-trigger[aria-expanded='true'] {
  background-color: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));
}

.wu-trigger[data-inspecting='true'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 38%, transparent);
  background-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 8%, transparent);
}

.wu-trigger[data-inspecting='true']:hover {
  background-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 14%, transparent);
}

.wu-trigger[data-collapsed='true'] {
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  justify-content: center;
  gap: 0;
}

.wu-avatar {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4d6bfe, #2563eb);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.wu-trigger[data-collapsed='true'] .wu-avatar {
  width: 24px;
  height: 24px;
  font-size: 10px;
}

.wu-avatar[data-admin='true'] {
  background: linear-gradient(135deg, #6366f1, #3b82f6);
  box-shadow: 0 0 0 1.5px var(--dsw-alias-state-warn-primary, #f59e0b);
}

.wu-avatar-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary, #f59e0b);
  border: 1.5px solid var(--dsw-specific-sidebar-fill, #ffffff);
}

.wu-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.wu-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.wu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #111827);
}

.wu-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  height: 16px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.01em;
}

.wu-badge-admin {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 16%, transparent);
  color: var(--dsw-alias-link, #3b82f6);
}

.wu-badge-inspect {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 20%, transparent);
  color: var(--dsw-alias-state-warn-label, #d97706);
}

.wu-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}

.wu-inspect-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  color: var(--dsw-alias-state-warn-label, #d97706);
}

.wu-caret {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  display: inline-flex;
  align-items: center;
}

.wu-menu {
  position: fixed;
  z-index: 950;
  min-width: 256px;
  max-width: 312px;
  padding: 6px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xl, 14px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #ffffff));
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
}

.wu-menu-head {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wu-menu-head-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wu-menu-name-wrap {
  min-width: 0;
  flex: 1;
}

.wu-menu-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wu-menu-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #111827);
  word-break: break-word;
}

.wu-menu-email {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  word-break: break-all;
}

.wu-menu-inspect-box {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 35%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 12%, transparent);
  color: var(--dsw-alias-state-warn-label, #b45309);
  font-size: 11.5px;
  line-height: 16px;
}

.wu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}

.wu-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 20px;
  text-decoration: none;
  text-align: left;
  cursor: pointer;
}

@media (hover: hover) {
  .wu-menu-item:hover {
    background-color: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.08));
  }
}

.wu-menu-item:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe);
  outline-offset: -2px;
}

.wu-menu-item-icon {
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-secondary, #6b7280));
}

.wu-menu-item-label {
  flex: 1;
  min-width: 0;
}

.wu-menu-item-shortcut {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #9ca3af);
}

.wu-shortcut-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.04));
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
}

.wu-shortcut-sep {
  padding: 0 1px;
  color: var(--dsw-alias-label-tertiary, #9ca3af);
}

.wu-menu-item-danger {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.wu-menu-item-danger .wu-menu-item-icon {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

@media (hover: hover) {
  .wu-menu-item-danger:hover {
    background-color: var(--dsw-alias-interactive-bg-hover-danger, rgba(220, 38, 38, 0.08));
  }
}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head) {
    return () => {}
  }
  const existing = document.head.querySelector(`style[data-plugin="${STYLE_ATTR_PLUGIN}"]`)
  if (existing) {
    existing.textContent = LAUNCHER_CSS
    return () => { existing.remove() }
  }
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-plugin', STYLE_ATTR_PLUGIN)
  styleEl.textContent = LAUNCHER_CSS
  document.head.appendChild(styleEl)
  return () => { styleEl.remove() }
}
