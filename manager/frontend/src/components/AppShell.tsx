import React, { useState } from 'react'
import {
  Blocks,
  Bot,
  ChevronDown,
  FolderKanban,
  Globe,
  Inbox,
  KeyRound,
  Layers,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { ActionMenu, Button, cn } from './ui'
import type { AppRoute } from '../lib/client.ts'
import { useI18n } from '../lib/i18nContext'
import type { AuthMe } from '../types'

interface NavItemDef {
  route: AppRoute
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
  badgeTone?: 'amber' | 'neutral'
}

export function AppShell({
  auth,
  brandName,
  activeRoute,
  onNavigate,
  pendingApprovalsCount,
  effectiveThemeMode,
  onToggleThemeMode,
  onLogout,
  children,
}: {
  auth: AuthMe
  brandName: string
  activeRoute: AppRoute
  onNavigate: (route: AppRoute) => void
  pendingApprovalsCount: number
  effectiveThemeMode: 'dark' | 'light' | 'slate'
  onToggleThemeMode: () => void
  onLogout: () => void
  children: React.ReactNode
}) {
  const { locale, setLocale, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const workspaceItems: NavItemDef[] = [
    { route: 'projects', label: t('nav.projects'), icon: FolderKanban },
    {
      route: 'inbox',
      label: t('nav.inbox'),
      icon: Inbox,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
      badgeTone: 'amber',
    },
    { route: 'workforce', label: t('nav.workforce'), icon: Bot },
  ]

  const teamGovernanceItems: NavItemDef[] =
    auth.is_team_lead && !auth.admin
      ? [{ route: 'analytics', label: t('nav.analytics'), icon: TrendingUp }]
      : []

  const governanceItems: NavItemDef[] = auth.admin
    ? [
        { route: 'analytics', label: t('nav.analytics'), icon: TrendingUp },
        { route: 'admin-workforce', label: t('nav.adminWorkforce'), icon: Layers },
        { route: 'admin-llm', label: t('nav.adminLlm'), icon: KeyRound },
        { route: 'admin-capabilities', label: t('nav.adminCapabilities'), icon: Blocks },
        { route: 'admin-access', label: t('nav.adminAccess'), icon: Users },
        { route: 'admin-ops', label: t('nav.adminOps'), icon: SlidersHorizontal },
      ]
    : []

  const allItems = [...workspaceItems, ...teamGovernanceItems, ...governanceItems]
  const currentItem = allItems.find((i) => i.route === activeRoute)

  const handleSelect = (route: AppRoute) => {
    onNavigate(route)
    setMobileOpen(false)
  }

  const renderNavSection = (title: string, items: NavItemDef[], compact: boolean) => (
    <div className="space-y-1">
      {!compact && (
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon
        const active = activeRoute === item.route
        return (
          <button
            key={item.route}
            type="button"
            title={compact ? item.label : undefined}
            onClick={() => handleSelect(item.route)}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-[var(--brand-radius-sm)] px-3 py-2 text-sm font-medium transition-colors cursor-pointer relative',
              compact && 'justify-center px-2',
              active
                ? 'brand-tab-active shadow-xs'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!compact && <span className="truncate flex-1 text-left">{item.label}</span>}
            {item.badge != null && (
              <span
                className={cn(
                  'rounded-full text-[11px] font-semibold leading-none',
                  compact
                    ? 'absolute top-1 right-1 h-4 min-w-4 px-1 flex items-center justify-center'
                    : 'px-2 py-0.5',
                  active
                    ? 'bg-black/25 text-white'
                    : item.badgeTone === 'amber'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35'
                      : 'bg-zinc-800 text-zinc-300',
                )}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      {/* Desktop Left Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 border-r border-zinc-800/80 bg-zinc-950/95 sticky top-0 h-screen transition-all duration-200',
          collapsed ? 'w-[70px]' : 'w-60',
        )}
      >
        <div
          className={cn(
            'h-16 flex items-center border-b border-zinc-800/80 px-4 gap-2.5',
            collapsed ? 'justify-center px-2' : 'justify-between',
          )}
        >
          <button
            type="button"
            onClick={() => handleSelect('projects')}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer"
          >
            <BrandMark svg={auth.brand_logo_svg} name={brandName} className="h-8 w-8 shrink-0" />
            {!collapsed && (
              <span className="font-semibold text-base tracking-tight truncate text-zinc-100">
                {brandName}
              </span>
            )}
          </button>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title={t('nav.collapseSidebar')}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {renderNavSection(t('nav.sectionWorkspace'), workspaceItems, collapsed)}
          {teamGovernanceItems.length > 0 && (
            <div className={cn(collapsed ? 'pt-2 border-t border-zinc-800/70' : '')}>
              {renderNavSection(t('nav.sectionTeamGovernance'), teamGovernanceItems, collapsed)}
            </div>
          )}
          {governanceItems.length > 0 && (
            <div className={cn(collapsed ? 'pt-2 border-t border-zinc-800/70' : '')}>
              {renderNavSection(t('nav.sectionGovernance'), governanceItems, collapsed)}
            </div>
          )}
        </nav>

        {collapsed && (
          <div className="p-2.5 border-t border-zinc-800/80 flex justify-center">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={t('nav.expandSidebar')}
              className="p-2 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-68 max-w-[82vw] bg-zinc-950 border-r border-zinc-800 flex flex-col h-full shadow-2xl">
            <div className="h-16 flex items-center justify-between px-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandMark svg={auth.brand_logo_svg} name={brandName} className="h-8 w-8 shrink-0" />
                <span className="font-semibold text-base truncate">{brandName}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {renderNavSection(t('nav.sectionWorkspace'), workspaceItems, false)}
              {teamGovernanceItems.length > 0 &&
                renderNavSection(t('nav.sectionTeamGovernance'), teamGovernanceItems, false)}
              {governanceItems.length > 0 &&
                renderNavSection(t('nav.sectionGovernance'), governanceItems, false)}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 border-b border-zinc-800/80 bg-zinc-950/88 backdrop-blur-md">
          <div className="h-full mx-auto brand-container px-4 sm:px-7 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2 min-w-0">
                {currentItem && <currentItem.icon className="h-4 w-4 text-indigo-400 shrink-0" />}
                <span className="font-semibold text-sm sm:text-base text-zinc-100 truncate">
                  {currentItem?.label || brandName}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <ActionMenu
                label={auth.email || 'Account'}
                trigger={
                  <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 pl-1.5 pr-2.5 py-1 hover:border-zinc-700 transition-colors">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full brand-btn-primary text-xs font-semibold uppercase">
                      {(auth.display_name || auth.email || 'U').slice(0, 1)}
                    </span>
                    <span className="hidden sm:inline max-w-36 truncate text-sm text-zinc-200">
                      {auth.display_name || auth.email.split('@')[0]}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                  </span>
                }
                header={
                  <div className="space-y-0.5">
                    <div className="font-medium text-zinc-200 truncate">
                      {auth.display_name || auth.email}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-500 truncate">
                      {auth.email} ·{' '}
                      {auth.admin
                        ? t('app.role.admin')
                        : auth.is_team_lead
                          ? t('app.role.teamLead')
                          : t('app.role.user')}
                    </div>
                  </div>
                }
                items={[
                  {
                    label:
                      effectiveThemeMode === 'light'
                        ? t('app.themeDark')
                        : t('app.themeLight'),
                    icon:
                      effectiveThemeMode === 'light' ? (
                        <Moon className="h-4 w-4 text-zinc-300" />
                      ) : (
                        <Sun className="h-4 w-4 text-amber-400" />
                      ),
                    onClick: onToggleThemeMode,
                  },
                  {
                    label: locale === 'zh-CN' ? 'Switch to English' : '切换为中文',
                    icon: <Globe className="h-4 w-4 text-zinc-400" />,
                    onClick: () => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN'),
                  },
                  ...(auth.auth_mode !== 'none'
                    ? [
                        {
                          label: t('app.logout'),
                          icon: <LogOut className="h-4 w-4" />,
                          onClick: onLogout,
                          danger: true,
                          dividerBefore: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full brand-container px-4 py-6 sm:px-7">
          {children}
        </main>
      </div>
    </div>
  )
}
