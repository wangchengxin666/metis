import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Cpu,
  KeyRound,
  Layers,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
} from 'lucide-react'
import { Card, CardContent, Button, cn } from '../../components/ui'
import { BackupRestoreDialog } from '../../components/BackupRestoreDialog'
import { WorkforceInspectorDialog } from '../../components/WorkforceInspectorDialog'
import { apiFetch } from '../../lib/client.ts'
import { copyTextToClipboard, fetchRunningStats } from '../../lib/format'
import { localizeAction } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AdminItem,
  CredentialProfileItem,
  LlmProfileItem,
  OidcProviderItem,
  OverviewData,
  RolePresetItem,
  SandboxItem,
  SandboxStats,
  TemplateItem,
  UserItem,
} from '../../types'
import { LlmAndVaultTab } from './LlmAndVaultTab'
import {
  AssembleTeamDialog,
  CloneEmployeeDialog,
  CloneFormState,
  ContainerLogsDialog,
  DestroySandboxDialog,
  TeamFormState,
} from './OperationsDialogs'
import { PluginsRegistryData, PluginsTab } from './PluginsTab'
import {
  EditSandboxDialog,
  EditSandboxFormState,
  ProvisionFormState,
  ProvisionSandboxDialog,
  TemplateEditorDialog,
  TemplateFormState,
} from './SandboxDialogs'
import { SandboxesTab } from './SandboxesTab'
import { SsoAndBrandingTab } from './SsoAndBrandingTab'
import { TemplatesTab } from './TemplatesTab'
import { UsersTab } from './UsersTab'

export function AdminConsoleView({
  publicUrl,
  notify,
  onBrandingUpdated,
}: {
  publicUrl: string
  notify: (msg: string, type?: 'success' | 'error') => void
  onBrandingUpdated?: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const formatAction = (action: 'start' | 'stop' | 'restart' | 'recreate') =>
    localizeAction(locale, action)

  const [activeTab, setActiveTab] = useState<
    'sandboxes' | 'templates' | 'plugins' | 'llm' | 'users' | 'sso'
  >('sandboxes')

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [rolePresets, setRolePresets] = useState<RolePresetItem[]>([])
  const [seedingPresets, setSeedingPresets] = useState(false)
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileItem[]>([])
  const [credentialProfiles, setCredentialProfiles] = useState<CredentialProfileItem[]>([])
  const [oidcProviders, setOidcProviders] = useState<OidcProviderItem[]>([])
  const [pluginsData, setPluginsData] = useState<PluginsRegistryData | null>(null)
  const [users, setUsers] = useState<UserItem[]>([])
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Provision Sandbox Modal
  const [createSbxOpen, setCreateSbxOpen] = useState(false)
  const [sbxForm, setSbxForm] = useState<ProvisionFormState>({
    email: '',
    display_name: '',
    initial_password: '',
    slug: '',
    template: 'agent-os',
    role_title: '',
    role_description: '',
    role_sop: '',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    cpu_limit: '2.0',
    memory_limit: '4g',
    llm_profile_id: '',
    init_repo_url: '',
    auto_install_plugins: 'file-manager',
    init_script: '',
    auto_sleep_exempt: false,
  })
  const [creatingSbx, setCreatingSbx] = useState(false)

  // Edit Sandbox Modal
  const [editSbx, setEditSbx] = useState<SandboxItem | null>(null)
  const [editSbxForm, setEditSbxForm] = useState<EditSandboxFormState>({
    role_title: '',
    role_description: '',
    role_sop: '',
    cpu_limit: '2.0',
    memory_limit: '4g',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    llm_profile_id: '',
    preview_auth_mode: 'public',
    daily_token_limit: '',
    auto_sleep_exempt: false,
  })
  const [savingSbx, setSavingSbx] = useState(false)

  // Workforce Inspector, Team Assembly, Clone, Backup, Logs & Delete Modals
  const [workforceTarget, setWorkforceTarget] = useState<SandboxItem | null>(null)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [teamForm, setTeamForm] = useState<TeamFormState>({
    name: '',
    description: '',
    member_ids: [],
    moderator_id: '',
  })
  const [assemblingTeam, setAssemblingTeam] = useState(false)
  const [cloneTarget, setCloneTarget] = useState<SandboxItem | null>(null)
  const [cloneForm, setCloneForm] = useState<CloneFormState>({
    email: '',
    display_name: '',
    slug: '',
    copy_workspace: true,
  })
  const [cloningSbx, setCloningSbx] = useState(false)
  const [backupTarget, setBackupTarget] = useState<SandboxItem | null>(null)
  const [deleteSbxTarget, setDeleteSbxTarget] = useState<SandboxItem | null>(null)
  const [purgeVolume, setPurgeVolume] = useState(false)
  const [logsTarget, setLogsTarget] = useState<SandboxItem | null>(null)
  const [logsText, setLogsText] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Template Modal (Create / Edit)
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [editingTpl, setEditingTpl] = useState<TemplateItem | null>(null)
  const [tplForm, setTplForm] = useState<TemplateFormState>({
    key: '',
    name: '',
    description: '',
    role_title: '',
    role_description: '',
    role_sop: '',
    default_llm_profile_id: '',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    default_cpu_limit: '2.0',
    default_memory_limit: '4g',
    auto_install_plugins: 'file-manager',
    init_script: '',
    default_env_json: '{}',
  })
  const [savingTpl, setSavingTpl] = useState(false)

  const copyText = async (key: string, text: string) => {
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopiedKey(key)
      notify(t('common.copied'))
      setTimeout(() => setCopiedKey(null), 2000)
    } else {
      notify(t('common.copyFailed'), 'error')
    }
  }

  const refreshingLiveRef = useRef(false)

  const refreshLiveStatus = useCallback(async () => {
    if (refreshingLiveRef.current) return
    refreshingLiveRef.current = true
    try {
      const [ov, sbxRes] = await Promise.all([
        apiFetch<OverviewData>('/api/overview'),
        apiFetch<{ items: SandboxItem[] }>('/api/sandboxes?refresh=true'),
      ])
      setOverview(ov)
      setSandboxes(sbxRes.items)
      const nextStats = await fetchRunningStats(sbxRes.items, '/api/sandboxes')
      setStatsMap(nextStats)
    } catch {
      // Background polling errors stay silent
    } finally {
      refreshingLiveRef.current = false
    }
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      const [ov, sbxRes, tplRes, presetsRes, llmRes, credRes, plgRes, usrRes, admRes, oidcRes] =
        await Promise.all([
          apiFetch<OverviewData>('/api/overview'),
          apiFetch<{ items: SandboxItem[] }>('/api/sandboxes?refresh=true'),
          apiFetch<TemplateItem[]>('/api/templates'),
          apiFetch<{ items: RolePresetItem[] }>('/api/templates/presets').catch(() => ({
            items: [] as RolePresetItem[],
          })),
          apiFetch<LlmProfileItem[]>('/api/llm-profiles'),
          apiFetch<CredentialProfileItem[]>('/api/credential-profiles').catch(
            () => [] as CredentialProfileItem[],
          ),
          apiFetch<PluginsRegistryData>('/api/plugins'),
          apiFetch<UserItem[]>('/api/users'),
          apiFetch<AdminItem[]>('/api/admins'),
          apiFetch<OidcProviderItem[]>('/api/oidc-providers'),
        ])
      setOverview(ov)
      setSandboxes(sbxRes.items)
      setTemplates(tplRes)
      setRolePresets(presetsRes.items || [])
      setLlmProfiles(llmRes)
      setCredentialProfiles(credRes)
      setPluginsData(plgRes)
      setUsers(usrRes)
      setAdmins(admRes)
      setOidcProviders(oidcRes)

      const nextStats = await fetchRunningStats(sbxRes.items, '/api/sandboxes')
      setStatsMap(nextStats)
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshLiveStatus()
    }, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLiveStatus()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshLiveStatus])

  const applyTemplateToSandboxForm = (tplKey: string, tplList = templates) => {
    const found = tplList.find((tpl) => tpl.key === tplKey)
    if (found) {
      setSbxForm((prev) => ({
        ...prev,
        template: found.key,
        role_title: found.role_title || found.name || '',
        role_description: found.role_description || found.description || '',
        role_sop: found.role_sop || '',
        llm_profile_id: found.default_llm_profile_id || prev.llm_profile_id,
        image_repo: found.image_repo,
        image_tag: found.image_tag,
        cpu_limit: String(found.default_cpu_limit),
        memory_limit: found.default_memory_limit,
        auto_install_plugins: found.auto_install_plugins || '',
        init_script: found.init_script || '',
      }))
    } else {
      setSbxForm((prev) => ({ ...prev, template: tplKey }))
    }
  }

  const openProvisionModalWithTemplate = (tplKey = 'agent-os') => {
    applyTemplateToSandboxForm(tplKey)
    setCreateSbxOpen(true)
  }

  const handleCreateSandbox = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingSbx(true)
    try {
      await apiFetch('/api/sandboxes', {
        method: 'POST',
        body: JSON.stringify({
          email: sbxForm.email.trim(),
          display_name: sbxForm.display_name.trim() || null,
          initial_password: sbxForm.initial_password.trim() || null,
          slug: sbxForm.slug.trim() || null,
          template: sbxForm.template,
          role_title: sbxForm.role_title.trim() || null,
          role_description: sbxForm.role_description.trim() || null,
          role_sop: sbxForm.role_sop.trim() || null,
          image_repo: sbxForm.image_repo.trim() || null,
          image_tag: sbxForm.image_tag.trim() || null,
          cpu_limit: parseFloat(sbxForm.cpu_limit) || 2.0,
          memory_limit: sbxForm.memory_limit.trim() || '4g',
          llm_profile_id: sbxForm.llm_profile_id || null,
          init_repo_url: sbxForm.init_repo_url.trim() || null,
          auto_install_plugins: sbxForm.auto_install_plugins.trim(),
          init_script: sbxForm.init_script,
          auto_sleep_exempt: sbxForm.auto_sleep_exempt,
        }),
      })
      notify(t('admin.sandboxProvisioned', { email: sbxForm.email }))
      setCreateSbxOpen(false)
      setSbxForm((prev) => ({
        ...prev,
        email: '',
        display_name: '',
        initial_password: '',
        slug: '',
      }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message || t('admin.sandboxCreateFailed'), 'error')
    } finally {
      setCreatingSbx(false)
    }
  }

  const handleSandboxAction = async (
    sbx: SandboxItem,
    action: 'start' | 'stop' | 'restart' | 'recreate',
  ) => {
    const actionLabel = formatAction(action)
    try {
      notify(t('admin.sandboxActionRunning', { slug: sbx.slug, action: actionLabel }))
      await apiFetch(`/api/sandboxes/${sbx.id}/${action}`, { method: 'POST' })
      notify(t('admin.sandboxActionSuccess', { slug: sbx.slug, action: actionLabel }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const openEditSandboxModal = (sbx: SandboxItem) => {
    setEditSbx(sbx)
    setEditSbxForm({
      role_title: sbx.role_title || '',
      role_description: sbx.role_description || '',
      role_sop: sbx.role_sop || '',
      cpu_limit: String(sbx.cpu_limit),
      memory_limit: sbx.memory_limit,
      image_repo: sbx.image_repo || 'dsh-sandbox',
      image_tag: sbx.image_tag,
      llm_profile_id: sbx.llm_profile_id || '',
      preview_auth_mode: sbx.preview_auth_mode || 'public',
      daily_token_limit: sbx.daily_token_limit ? String(sbx.daily_token_limit) : '',
      auto_sleep_exempt: Boolean(sbx.auto_sleep_exempt),
    })
  }

  const handleSaveSandboxSpec = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editSbx) return
    setSavingSbx(true)
    try {
      const tokenLimitNum = editSbxForm.daily_token_limit.trim()
        ? Math.max(0, Number.parseInt(editSbxForm.daily_token_limit.trim(), 10) || 0)
        : 0
      await apiFetch(`/api/sandboxes/${editSbx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role_title: editSbxForm.role_title.trim(),
          role_description: editSbxForm.role_description.trim(),
          role_sop: editSbxForm.role_sop,
          cpu_limit: parseFloat(editSbxForm.cpu_limit) || editSbx.cpu_limit,
          memory_limit: editSbxForm.memory_limit.trim() || editSbx.memory_limit,
          image_repo: editSbxForm.image_repo.trim(),
          image_tag: editSbxForm.image_tag.trim(),
          llm_profile_id: editSbxForm.llm_profile_id,
          preview_auth_mode: editSbxForm.preview_auth_mode,
          daily_token_limit: tokenLimitNum,
          auto_sleep_exempt: editSbxForm.auto_sleep_exempt,
        }),
      })
      notify(t('admin.sandboxUpdated', { slug: editSbx.slug }))
      setEditSbx(null)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingSbx(false)
    }
  }

  const handleSeedRolePresets = async () => {
    setSeedingPresets(true)
    try {
      await apiFetch<TemplateItem[]>('/api/templates/seed-presets', { method: 'POST' })
      notify(t('admin.presetsSeeded'))
      await refreshAll()
    } catch (err: any) {
      notify(err.message || 'Seed failed', 'error')
    } finally {
      setSeedingPresets(false)
    }
  }

  const openAssembleTeamModal = () => {
    const runningIds = sandboxes.filter((s) => s.status === 'running').map((s) => s.id)
    setTeamForm({
      name: '',
      description: '',
      member_ids: runningIds,
      moderator_id: runningIds[0] || '',
    })
    setTeamModalOpen(true)
  }

  const handleAssembleTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (teamForm.member_ids.length < 2) return
    setAssemblingTeam(true)
    try {
      const teamName = teamForm.name.trim()
      const res = await apiFetch<{
        ok: boolean
        room_name?: string
        team_name?: string
        paired_members?: number
        synced?: number
      }>('/api/teams/assemble', {
        method: 'POST',
        body: JSON.stringify({
          name: teamName,
          description: teamForm.description.trim() || null,
          member_ids: teamForm.member_ids,
          moderator_id: teamForm.moderator_id || null,
        }),
      })
      if (teamForm.description.trim()) {
        try {
          await apiFetch('/api/teams/sync-shared', {
            method: 'POST',
            body: JSON.stringify({
              team_name: teamName,
              sandbox_ids: teamForm.member_ids,
              file_name: 'PROJECT_BRIEF.md',
              content: `# ${teamName}\n\n${teamForm.description.trim()}\n`,
            }),
          })
        } catch {
          // Non-fatal: TEAM_README.md is already written during assemble
        }
      }
      notify(
        t('dialog.team.success', {
          name: res.room_name || res.team_name || teamName,
          paired: res.paired_members ?? res.synced ?? teamForm.member_ids.length,
        }),
      )
      setTeamModalOpen(false)
      await refreshAll()
    } catch (err: any) {
      notify(err.message || 'Team assembly failed', 'error')
    } finally {
      setAssemblingTeam(false)
    }
  }

  const openCloneModal = (sbx: SandboxItem) => {
    setCloneTarget(sbx)
    setCloneForm({
      email: sbx.email,
      display_name: sbx.display_name || '',
      slug: `${sbx.slug}-copy`,
      copy_workspace: true,
    })
  }

  const handleCloneSandbox = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cloneTarget) return
    setCloningSbx(true)
    try {
      const res = await apiFetch<SandboxItem>(`/api/sandboxes/${cloneTarget.id}/clone`, {
        method: 'POST',
        body: JSON.stringify({
          email: cloneForm.email.trim() || null,
          display_name: cloneForm.display_name.trim() || null,
          slug: cloneForm.slug.trim() || null,
          copy_workspace: cloneForm.copy_workspace,
        }),
      })
      notify(t('dialog.clone.success', { slug: res.slug }))
      setCloneTarget(null)
      await refreshAll()
    } catch (err: any) {
      notify(err.message || 'Clone failed', 'error')
    } finally {
      setCloningSbx(false)
    }
  }

  const handleConfirmDeleteSandbox = async () => {
    if (!deleteSbxTarget) return
    try {
      await apiFetch(
        `/api/sandboxes/${deleteSbxTarget.id}?purge_volume=${purgeVolume ? 'true' : 'false'}`,
        { method: 'DELETE' },
      )
      notify(t('admin.sandboxDestroyed', { slug: deleteSbxTarget.slug }))
      setDeleteSbxTarget(null)
      setPurgeVolume(false)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const openLogsModal = async (sbx: SandboxItem) => {
    setLogsTarget(sbx)
    setLoadingLogs(true)
    try {
      const res = await apiFetch<{ logs: string }>(`/api/sandboxes/${sbx.id}/logs?tail=400`)
      const cleaned = (res.logs || '')
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\u2009/g, ' ')
      setLogsText(cleaned || t('admin.noLogs'))
    } catch (err: any) {
      setLogsText(t('admin.logsLoadFailed', { message: err.message }))
    } finally {
      setLoadingLogs(false)
    }
  }

  const openCreateTemplateModal = () => {
    setEditingTpl(null)
    setTplForm({
      key: '',
      name: '',
      description: '',
      role_title: '',
      role_description: '',
      role_sop: '',
      default_llm_profile_id: '',
      image_repo: overview?.default_image_repo || 'dsh-sandbox',
      image_tag: overview?.default_image_tag || 'latest',
      default_cpu_limit: '2.0',
      default_memory_limit: '4g',
      auto_install_plugins: 'file-manager',
      init_script: '',
      default_env_json: '{}',
    })
    setTplModalOpen(true)
  }

  const openEditTemplateModal = (tpl: TemplateItem) => {
    setEditingTpl(tpl)
    setTplForm({
      key: tpl.key,
      name: tpl.name,
      description: tpl.description || '',
      role_title: tpl.role_title || '',
      role_description: tpl.role_description || '',
      role_sop: tpl.role_sop || '',
      default_llm_profile_id: tpl.default_llm_profile_id || '',
      image_repo: tpl.image_repo,
      image_tag: tpl.image_tag,
      default_cpu_limit: String(tpl.default_cpu_limit),
      default_memory_limit: tpl.default_memory_limit,
      auto_install_plugins: tpl.auto_install_plugins || '',
      init_script: tpl.init_script || '',
      default_env_json: tpl.default_env_json || '{}',
    })
    setTplModalOpen(true)
  }

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingTpl(true)
    try {
      const payload = {
        name: tplForm.name.trim(),
        description: tplForm.description.trim() || null,
        role_title: tplForm.role_title.trim() || null,
        role_description: tplForm.role_description.trim() || null,
        role_sop: tplForm.role_sop.trim() || null,
        default_llm_profile_id: tplForm.default_llm_profile_id || null,
        image_repo: tplForm.image_repo.trim(),
        image_tag: tplForm.image_tag.trim(),
        default_cpu_limit: parseFloat(tplForm.default_cpu_limit) || 2.0,
        default_memory_limit: tplForm.default_memory_limit.trim(),
        auto_install_plugins: tplForm.auto_install_plugins.trim(),
        init_script: tplForm.init_script,
        default_env_json: tplForm.default_env_json.trim() || '{}',
      }
      if (editingTpl) {
        await apiFetch(`/api/templates/${editingTpl.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        notify(t('admin.templateUpdated', { name: tplForm.name }))
      } else {
        await apiFetch('/api/templates', {
          method: 'POST',
          body: JSON.stringify({ key: tplForm.key.trim(), ...payload }),
        })
        notify(t('admin.templateCreated', { name: tplForm.name }))
      }
      setTplModalOpen(false)
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingTpl(false)
    }
  }

  const handleDeleteTemplate = async (tpl: TemplateItem) => {
    if (!window.confirm(t('admin.templateDeleteConfirm', { name: tpl.name, key: tpl.key }))) return
    try {
      await apiFetch(`/api/templates/${tpl.id}`, { method: 'DELETE' })
      notify(t('admin.templateDeleted', { key: tpl.key }))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const enabledOidcCount = oidcProviders.filter((p) => p.enabled).length
  const effectiveAllowLocalUser =
    overview?.allow_local_user_login ?? overview?.manager_auth_mode !== 'oidc'

  return (
    <div className="space-y-6">
      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">{t('admin.kpi.sandboxesTitle')}</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-emerald-400">
                  {overview?.running_sandboxes ?? 0}
                </span>
                <span className="text-base text-zinc-500">/ {overview?.total_sandboxes ?? 0}</span>
              </div>
            </div>
            <div className="rounded-[var(--brand-radius-md)] bg-emerald-500/10 p-3 text-emerald-400 border border-emerald-500/20">
              <Box className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">{t('admin.kpi.quotaTitle')}</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-zinc-100">
                  {overview?.allocated_cpus ?? 0}
                </span>
                <span className="text-sm text-zinc-400">{t('admin.kpi.quotaUnit')}</span>
              </div>
            </div>
            <div className="rounded-[var(--brand-radius-md)] bg-indigo-500/10 p-3 text-indigo-400 border border-indigo-500/20">
              <Cpu className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-zinc-700 transition-colors"
          onClick={() => setActiveTab('templates')}
        >
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">{t('admin.kpi.templatesTitle')}</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-zinc-100">{templates.length}</span>
                {t('admin.kpi.templatesUnit') && (
                  <span className="text-sm text-zinc-400">{t('admin.kpi.templatesUnit')}</span>
                )}
              </div>
            </div>
            <div className="rounded-[var(--brand-radius-md)] bg-amber-500/10 p-3 text-amber-400 border border-amber-500/20">
              <Layers className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-zinc-700 transition-colors"
          onClick={() => setActiveTab('plugins')}
        >
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">{t('admin.kpi.pluginsTitle')}</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-zinc-100">
                  {pluginsData?.items.length ?? 0}
                </span>
                {t('admin.kpi.pluginsUnit') && (
                  <span className="text-sm text-zinc-400">{t('admin.kpi.pluginsUnit')}</span>
                )}
              </div>
            </div>
            <div className="rounded-[var(--brand-radius-md)] bg-violet-500/10 p-3 text-violet-400 border border-violet-500/20">
              <Package className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] bg-zinc-900/90 p-1 border border-zinc-800/90">
          {[
            { id: 'sandboxes', label: t('admin.tabs.sandboxes'), icon: Terminal, count: sandboxes.length },
            { id: 'templates', label: t('admin.tabs.templates'), icon: Layers, count: templates.length },
            { id: 'plugins', label: t('admin.tabs.plugins'), icon: Package, count: pluginsData?.items.length ?? 0 },
            { id: 'llm', label: t('admin.tabs.llm'), icon: KeyRound, count: llmProfiles.length },
            { id: 'users', label: t('admin.tabs.users'), icon: Users, count: users.length },
            { id: 'sso', label: t('admin.tabs.sso'), icon: ShieldCheck, count: enabledOidcCount },
          ].map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-4 py-2 text-sm font-medium transition-all cursor-pointer',
                  active
                    ? 'brand-tab-active shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    active ? 'bg-black/20' : 'bg-zinc-800 text-zinc-400',
                  )}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          {activeTab === 'templates' ? (
            <>
              <Button variant="outline" size="sm" disabled={seedingPresets} onClick={handleSeedRolePresets}>
                <Sparkles className={cn('h-3.5 w-3.5 text-indigo-400', seedingPresets && 'animate-spin')} />
                {t('admin.seedPresetsBtn')}
              </Button>
              <Button size="sm" onClick={openCreateTemplateModal}>
                <Plus className="h-3.5 w-3.5" />
                {t('admin.newTemplateBtn')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={sandboxes.length < 2} onClick={openAssembleTeamModal}>
                <Users className="h-3.5 w-3.5 text-indigo-400" />
                {t('admin.assembleTeamBtn')}
              </Button>
              <Button size="sm" onClick={() => openProvisionModalWithTemplate('agent-os')}>
                <Plus className="h-3.5 w-3.5" />
                {t('admin.provisionSandboxBtn')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Active Tab Panel */}
      {activeTab === 'sandboxes' && (
        <SandboxesTab
          sandboxes={sandboxes}
          statsMap={statsMap}
          overview={overview}
          onRefresh={refreshAll}
          notify={notify}
          onWorkforce={setWorkforceTarget}
          onSandboxAction={handleSandboxAction}
          onLogs={openLogsModal}
          onEdit={openEditSandboxModal}
          onClone={openCloneModal}
          onBackup={setBackupTarget}
          onDestroy={(sbx) => {
            setDeleteSbxTarget(sbx)
            setPurgeVolume(false)
          }}
        />
      )}

      {activeTab === 'templates' && (
        <TemplatesTab
          templates={templates}
          overview={overview}
          onProvisionWithTemplate={openProvisionModalWithTemplate}
          onEditTemplate={openEditTemplateModal}
          onDeleteTemplate={handleDeleteTemplate}
        />
      )}

      {activeTab === 'plugins' && pluginsData && (
        <PluginsTab
          pluginsData={pluginsData}
          copiedKey={copiedKey}
          onCopy={copyText}
          onRefresh={refreshAll}
          notify={notify}
        />
      )}

      {activeTab === 'llm' && (
        <LlmAndVaultTab
          llmProfiles={llmProfiles}
          credentialProfiles={credentialProfiles}
          sandboxes={sandboxes}
          onRefresh={refreshAll}
          notify={notify}
        />
      )}

      {activeTab === 'users' && (
        <UsersTab
          users={users}
          admins={admins}
          overview={overview}
          enabledOidcCount={enabledOidcCount}
          effectiveAllowLocalUser={effectiveAllowLocalUser}
          onRefresh={refreshAll}
          notify={notify}
        />
      )}

      {activeTab === 'sso' && (
        <SsoAndBrandingTab
          publicUrl={publicUrl}
          overview={overview}
          oidcProviders={oidcProviders}
          copiedKey={copiedKey}
          onCopy={copyText}
          onRefresh={refreshAll}
          onBrandingUpdated={onBrandingUpdated}
          notify={notify}
        />
      )}

      {/* Modals */}
      <ProvisionSandboxDialog
        open={createSbxOpen}
        onOpenChange={setCreateSbxOpen}
        form={sbxForm}
        setForm={setSbxForm}
        creating={creatingSbx}
        onSubmit={handleCreateSandbox}
        onApplyTemplate={(key) => applyTemplateToSandboxForm(key)}
        users={users}
        templates={templates}
        llmProfiles={llmProfiles}
        effectiveAllowLocalUser={effectiveAllowLocalUser}
      />

      <TemplateEditorDialog
        open={tplModalOpen}
        onOpenChange={setTplModalOpen}
        editing={editingTpl}
        form={tplForm}
        setForm={setTplForm}
        saving={savingTpl}
        onSubmit={handleSaveTemplate}
        rolePresets={rolePresets}
        overview={overview}
      />

      <EditSandboxDialog
        target={editSbx}
        onClose={() => setEditSbx(null)}
        form={editSbxForm}
        setForm={setEditSbxForm}
        saving={savingSbx}
        onSubmit={handleSaveSandboxSpec}
        llmProfiles={llmProfiles}
      />

      <WorkforceInspectorDialog
        sandbox={
          workforceTarget
            ? sandboxes.find((s) => s.id === workforceTarget.id) ?? workforceTarget
            : null
        }
        isAdmin={true}
        onClose={() => setWorkforceTarget(null)}
        notify={notify}
        onSandboxUpdated={refreshAll}
      />

      <AssembleTeamDialog
        open={teamModalOpen}
        onOpenChange={setTeamModalOpen}
        form={teamForm}
        setForm={setTeamForm}
        submitting={assemblingTeam}
        onSubmit={handleAssembleTeam}
        sandboxes={sandboxes}
      />

      <CloneEmployeeDialog
        target={cloneTarget}
        onClose={() => setCloneTarget(null)}
        form={cloneForm}
        setForm={setCloneForm}
        submitting={cloningSbx}
        onSubmit={handleCloneSandbox}
      />

      <BackupRestoreDialog
        sandbox={backupTarget}
        isAdmin={true}
        onClose={() => setBackupTarget(null)}
        notify={notify}
        onRestored={refreshAll}
      />

      <ContainerLogsDialog
        target={logsTarget}
        onClose={() => setLogsTarget(null)}
        logsText={logsText}
        loading={loadingLogs}
        onRefresh={openLogsModal}
        onCopy={copyText}
      />

      <DestroySandboxDialog
        target={deleteSbxTarget}
        onClose={() => setDeleteSbxTarget(null)}
        purgeVolume={purgeVolume}
        setPurgeVolume={setPurgeVolume}
        onConfirm={handleConfirmDeleteSandbox}
      />
    </div>
  )
}
