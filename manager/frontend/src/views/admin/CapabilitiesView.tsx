import { BookOpen, Cpu, Lock, Package } from 'lucide-react'
import { Badge, cn } from '../../components/ui'
import { useI18n } from '../../lib/i18nContext'
import type {
  CredentialPresetItem,
  CredentialProfileItem,
  McpServerItem,
  SandboxItem,
  SkillItem,
} from '../../types'
import { CredentialVaultSection } from './CredentialVaultSection'
import { McpCenterTab } from './McpCenterTab'
import { PluginsRegistryData, PluginsTab } from './PluginsTab'
import { SkillsCenterTab } from './SkillsCenterTab'

export type CapabilitySubTab = 'plugins' | 'credentials' | 'mcp' | 'skills'

export function CapabilitiesView({
  activeSubTab,
  onSelectSubTab,
  pluginsData,
  credentialProfiles,
  credentialPresets,
  mcpServers,
  skills,
  sandboxes,
  copiedKey,
  onCopy,
  onRefresh,
  notify,
}: {
  activeSubTab: CapabilitySubTab
  onSelectSubTab: (tab: CapabilitySubTab) => void
  pluginsData: PluginsRegistryData | null
  credentialProfiles: CredentialProfileItem[]
  credentialPresets: CredentialPresetItem[]
  mcpServers: McpServerItem[]
  skills: SkillItem[]
  sandboxes: SandboxItem[]
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onRefresh: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()

  const tabs: Array<{
    key: CapabilitySubTab
    label: string
    count: number
    icon: typeof Package
  }> = [
    {
      key: 'plugins',
      label: t('admin.subtab.plugins'),
      count: pluginsData?.items.length ?? 0,
      icon: Package,
    },
    {
      key: 'credentials',
      label: t('admin.subtab.credentials'),
      count: credentialProfiles.length,
      icon: Lock,
    },
    {
      key: 'mcp',
      label: t('admin.subtab.mcp'),
      count: mcpServers.length,
      icon: Cpu,
    },
    {
      key: 'skills',
      label: t('admin.subtab.skills'),
      count: skills.length,
      icon: BookOpen,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeSubTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelectSubTab(tab.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                active
                  ? 'brand-tab-active'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              <Badge
                variant={active ? 'default' : 'outline'}
                className={cn(
                  'ml-0.5 text-[10px] px-1.5 py-0',
                  active && 'bg-black/25 border-transparent text-white',
                )}
              >
                {tab.count}
              </Badge>
            </button>
          )
        })}
      </div>

      {activeSubTab === 'plugins' && pluginsData && (
        <PluginsTab
          pluginsData={pluginsData}
          sandboxes={sandboxes}
          copiedKey={copiedKey}
          onCopy={onCopy}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {activeSubTab === 'credentials' && (
        <CredentialVaultSection
          credentialProfiles={credentialProfiles}
          credentialPresets={credentialPresets}
          sandboxes={sandboxes}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {activeSubTab === 'mcp' && (
        <McpCenterTab
          mcpServers={mcpServers}
          sandboxes={sandboxes}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {activeSubTab === 'skills' && (
        <SkillsCenterTab
          skills={skills}
          sandboxes={sandboxes}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  )
}
