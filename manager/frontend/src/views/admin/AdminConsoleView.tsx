import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Cpu,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Button, cn } from '../../components/ui'
import { BackupRestoreDialog } from '../../components/BackupRestoreDialog'
import { WorkforceInspectorDialog } from '../../components/WorkforceInspectorDialog'
import { type AdminSection, apiFetch } from '../../lib/client.ts'
import { copyTextToClipboard, fetchRunningStats, mergeStatsMap } from '../../lib/format'
import { DEFAULT_CORE_AUTO_INSTALL_PLUGINS } from '../../lib/plugins.ts'
import { localizeAction } from '../../lib/i18n.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AdminItem,
  AuthMe,
  CredentialPresetItem,
  CredentialProfileItem,
  LlmProfileItem,
  McpServerItem,
  OidcProviderItem,
  OverviewData,
  RolePresetItem,
  SandboxItem,
  SandboxStats,
  SkillItem,
  TemplateItem,
  UserItem,
} from '../../types'
import { PlaybooksView } from '../workspace/PlaybooksView'
import { AuditCenterTab } from './AuditCenterTab'
import { CapabilitiesView, type CapabilitySubTab } from './CapabilitiesView'
import { LlmAndVaultTab } from './LlmAndVaultTab'
import { NotificationsTab } from './NotificationsTab'
import {
  CloneEmployeeDialog,
  CloneFormState,
  ContainerLogsDialog,
  DestroySandboxDialog,
} from './OperationsDialogs'
import { PluginsRegistryData } from './PluginsTab'
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
  auth,
  publicUrl,
  activeSection,
  onSelectSection,
  notify,
  onBrandingUpdated,
}: {
  auth: AuthMe
  publicUrl: string
  activeSection: AdminSection
  onSelectSection: (section: AdminSection) => void
  notify: (msg: string, type?: 'success' | 'error') => void
  onBrandingUpdated?: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const formatAction = (action: 'start' | 'stop' | 'restart' | 'recreate') =>
    localizeAction(locale, action)

  const activeTab = activeSection
  const setActiveTab = onSelectSection
  const [workforceSubTab, setWorkforceSubTab] = useState<'sandboxes' | 'templates' | 'playbooks'>('sandboxes')
  const [capSubTab, setCapSubTab] = useState<CapabilitySubTab>('plugins')
  const [accessSubTab, setAccessSubTab] = useState<'users' | 'sso'>('users')
  const [opsSubTab, setOpsSubTab] = useState<'notifications' | 'audit'>('notifications')

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SandboxStats>>({})
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [rolePresets, setRolePresets] = useState<RolePresetItem[]>([])
  const [seedingPresets, setSeedingPresets] = useState(false)
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileItem[]>([])
  const [credentialProfiles, setCredentialProfiles] = useState<CredentialProfileItem[]>([])
  const [credentialPresets, setCredentialPresets] = useState<CredentialPresetItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
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
    ownership_mode: 'personal',
    maintainer_emails: '',
    daily_cost_limit: '',
    budget_action: 'block',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    cpu_limit: '2.0',
    memory_limit: '4g',
    llm_profile_id: '',
    credential_profile_ids: [],
    mcp_server_ids: [],
    skill_ids: [],
    init_repo_url: '',
    auto_install_plugins: DEFAULT_CORE_AUTO_INSTALL_PLUGINS,
    init_script: '',
    auto_sleep_exempt: false,
  })
  const [creatingSbx, setCreatingSbx] = useState(false)

  // Edit Sandbox Modal
  const [editSbx, setEditSbx] = useState<SandboxItem | null>(null)
  const [editSbxForm, setEditSbxForm] = useState<EditSandboxFormState>({
    display_name: '',
    role_title: '',
    role_description: '',
    role_sop: '',
    ownership_mode: 'personal',
    maintainer_emails: '',
    cpu_limit: '2.0',
    memory_limit: '4g',
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    llm_profile_id: '',
    credential_profile_ids: [],
    mcp_server_ids: [],
    skill_ids: [],
    preview_auth_mode: 'public',
    daily_cost_limit: '',
    budget_action: 'block',
    auto_sleep_exempt: false,
  })
  const [savingSbx, setSavingSbx] = useState(false)

  // Workforce Inspector, Clone, Backup, Logs & Delete Modals
  const [workforceTarget, setWorkforceTarget] = useState<SandboxItem | null>(null)
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
    default_credential_profile_ids: [],
    default_mcp_server_ids: [],
    default_skill_ids: [],
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    default_cpu_limit: '2.0',
    default_memory_limit: '4g',
    auto_install_plugins: DEFAULT_CORE_AUTO_INSTALL_PLUGINS,
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
  const statsInFlightRef = useRef(false)

  const loadRunningStats = useCallback(
    (items: SandboxItem[], opts?: { includeDisk?: boolean }) => {
      if (statsInFlightRef.current) return
      statsInFlightRef.current = true
      void fetchRunningStats(items, '/api/sandboxes', opts)
        .then((nextStats) => {
          setStatsMap((prev) => mergeStatsMap(prev, nextStats))
        })
        .catch(() => {})
        .finally(() => {
          statsInFlightRef.current = false
        })
    },
    [],
  )

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
      loadRunningStats(sbxRes.items, { includeDisk: false })
    } catch {
      // Background polling errors stay silent
    } finally {
      refreshingLiveRef.current = false
    }
  }, [loadRunningStats])

  const refreshAll = useCallback(async () => {
    // Paint the employee list as soon as it arrives instead of waiting for every
    // admin resource; live CPU/memory/disk stats are loaded in the background.
    const sandboxesReq = apiFetch<{ items: SandboxItem[] }>('/api/sandboxes?refresh=true').then(
      (res) => {
        setSandboxes(res.items)
        loadRunningStats(res.items, { includeDisk: true })
        return res
      },
    )
    try {
      const [
        ov,
        ,
        tplRes,
        presetsRes,
        llmRes,
        credRes,
        credPresetsRes,
        mcpRes,
        skillsRes,
        plgRes,
        usrRes,
        admRes,
        oidcRes,
      ] = await Promise.all([
        apiFetch<OverviewData>('/api/overview'),
        sandboxesReq,
        apiFetch<TemplateItem[]>('/api/templates'),
        apiFetch<{ items: RolePresetItem[] }>('/api/templates/presets').catch(() => ({
          items: [] as RolePresetItem[],
        })),
        apiFetch<LlmProfileItem[]>('/api/llm-profiles'),
        apiFetch<CredentialProfileItem[]>('/api/credential-profiles').catch(
          () => [] as CredentialProfileItem[],
        ),
        apiFetch<{ items: CredentialPresetItem[] }>('/api/credential-profiles/presets').catch(
          () => ({ items: [] as CredentialPresetItem[] }),
        ),
        apiFetch<McpServerItem[]>('/api/mcp-servers').catch(() => [] as McpServerItem[]),
        apiFetch<SkillItem[]>('/api/skills').catch(() => [] as SkillItem[]),
        apiFetch<PluginsRegistryData>('/api/plugins'),
        apiFetch<UserItem[]>('/api/users'),
        apiFetch<AdminItem[]>('/api/admins'),
        apiFetch<OidcProviderItem[]>('/api/oidc-providers'),
      ])
      setOverview(ov)
      setTemplates(tplRes)
      setRolePresets(presetsRes.items || [])
      setLlmProfiles(llmRes)
      setCredentialProfiles(credRes)
      setCredentialPresets(credPresetsRes.items || [])
      setMcpServers(mcpRes)
      setSkills(skillsRes)
      setPluginsData(plgRes)
      setUsers(usrRes)
      setAdmins(admRes)
      setOidcProviders(oidcRes)
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify, loadRunningStats])

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
        credential_profile_ids: [...(found.default_credential_profile_ids || [])],
        mcp_server_ids: [...(found.default_mcp_server_ids || [])],
        skill_ids: [...(found.default_skill_ids || [])],
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
          ownership_mode: sbxForm.ownership_mode,
          maintainer_emails: sbxForm.maintainer_emails
            .split(/[\s,;]+/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
          daily_cost_limit: sbxForm.daily_cost_limit.trim()
            ? Math.max(0, Number.parseFloat(sbxForm.daily_cost_limit.trim()) || 0)
            : null,
          budget_action: sbxForm.budget_action,
          image_repo: sbxForm.image_repo.trim() || null,
          image_tag: sbxForm.image_tag.trim() || null,
          cpu_limit: parseFloat(sbxForm.cpu_limit) || 2.0,
          memory_limit: sbxForm.memory_limit.trim() || '4g',
          llm_profile_id: sbxForm.llm_profile_id || null,
          credential_profile_ids: sbxForm.credential_profile_ids,
          mcp_server_ids: sbxForm.mcp_server_ids,
          skill_ids: sbxForm.skill_ids,
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
      display_name: sbx.display_name || '',
      role_title: sbx.role_title || '',
      role_description: sbx.role_description || '',
      role_sop: sbx.role_sop || '',
      ownership_mode: sbx.ownership_mode || 'personal',
      maintainer_emails: (sbx.maintainer_emails || []).join(', '),
      cpu_limit: String(sbx.cpu_limit),
      memory_limit: sbx.memory_limit,
      image_repo: sbx.image_repo || 'dsh-sandbox',
      image_tag: sbx.image_tag,
      llm_profile_id: sbx.llm_profile_id || '',
      credential_profile_ids: [...(sbx.credential_profile_ids || [])],
      mcp_server_ids: [...(sbx.mcp_server_ids || [])],
      skill_ids: [...(sbx.skill_ids || [])],
      preview_auth_mode: sbx.preview_auth_mode || 'public',
      daily_cost_limit:
        sbx.daily_cost_limit != null && sbx.daily_cost_limit > 0
          ? String(sbx.daily_cost_limit)
          : '',
      budget_action: sbx.budget_action || 'block',
      auto_sleep_exempt: Boolean(sbx.auto_sleep_exempt),
    })
  }

  const handleRotateGatewayKey = async (sbx: SandboxItem) => {
    try {
      await apiFetch(`/api/sandboxes/${sbx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rotate_gateway_key: true }),
      })
      notify(t('sandbox.rotateGatewayKeyOk'))
      await refreshAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleSaveSandboxSpec = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editSbx) return
    setSavingSbx(true)
    try {
      const costLimitNum = editSbxForm.daily_cost_limit.trim()
        ? Math.max(0, Number.parseFloat(editSbxForm.daily_cost_limit.trim()) || 0)
        : 0
      await apiFetch(`/api/sandboxes/${editSbx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: editSbxForm.display_name.trim(),
          role_title: editSbxForm.role_title.trim(),
          role_description: editSbxForm.role_description.trim(),
          role_sop: editSbxForm.role_sop,
          ownership_mode: editSbxForm.ownership_mode,
          maintainer_emails: editSbxForm.maintainer_emails
            .split(/[\s,;]+/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
          cpu_limit: parseFloat(editSbxForm.cpu_limit) || editSbx.cpu_limit,
          memory_limit: editSbxForm.memory_limit.trim() || editSbx.memory_limit,
          image_repo: editSbxForm.image_repo.trim(),
          image_tag: editSbxForm.image_tag.trim(),
          llm_profile_id: editSbxForm.llm_profile_id,
          credential_profile_ids: editSbxForm.credential_profile_ids,
          mcp_server_ids: editSbxForm.mcp_server_ids,
          skill_ids: editSbxForm.skill_ids,
          preview_auth_mode: editSbxForm.preview_auth_mode,
          daily_cost_limit: costLimitNum,
          budget_action: editSbxForm.budget_action,
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
      default_credential_profile_ids: [],
      default_mcp_server_ids: [],
      default_skill_ids: [],
      image_repo: overview?.default_image_repo || 'dsh-sandbox',
      image_tag: overview?.default_image_tag || 'latest',
      default_cpu_limit: '2.0',
      default_memory_limit: '4g',
      auto_install_plugins: pluginsData?.auto_install_default || DEFAULT_CORE_AUTO_INSTALL_PLUGINS,
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
      default_credential_profile_ids: [...(tpl.default_credential_profile_ids || [])],
      default_mcp_server_ids: [...(tpl.default_mcp_server_ids || [])],
      default_skill_ids: [...(tpl.default_skill_ids || [])],
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
        default_credential_profile_ids: tplForm.default_credential_profile_ids,
        default_mcp_server_ids: tplForm.default_mcp_server_ids,
        default_skill_ids: tplForm.default_skill_ids,
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
    <div className="space-y-5">
      {/* Compact Single-Line Status Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <Box className="h-4 w-4 text-emerald-400" />
            <span>{t('admin.kpi.sandboxesTitle')}</span>
            <strong className="font-semibold text-emerald-400">
              {overview?.running_sandboxes ?? 0}
            </strong>
            <span className="text-zinc-500">/ {overview?.total_sandboxes ?? 0}</span>
          </span>
          <span className="text-zinc-700">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Cpu className="h-4 w-4 text-indigo-400" />
            <span>{t('admin.kpi.quotaTitle')}</span>
            <strong className="font-semibold text-zinc-100">
              {overview?.allocated_cpus ?? 0} {t('admin.kpi.quotaUnit')}
            </strong>
          </span>
          <span className="text-zinc-700 hidden sm:inline">·</span>
          <button
            type="button"
            onClick={() => {
              setActiveTab('workforce')
              setWorkforceSubTab('templates')
            }}
            className="hidden sm:inline-flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <Layers className="h-4 w-4 text-amber-400" />
            <span>{t('admin.kpi.templatesTitle')}</span>
            <strong className="font-semibold text-zinc-100">{templates.length}</strong>
          </button>
          <span className="text-zinc-700 hidden md:inline">·</span>
          <button
            type="button"
            onClick={() => {
              setActiveTab('capabilities')
              setCapSubTab('plugins')
            }}
            className="hidden md:inline-flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <Package className="h-4 w-4 text-violet-400" />
            <span>{t('admin.kpi.pluginsTitle')}</span>
            <strong className="font-semibold text-zinc-100">
              {pluginsData?.items.length ?? 0}
            </strong>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refreshAll}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          {activeTab === 'workforce' && workforceSubTab === 'templates' ? (
            <>
              <Button variant="outline" size="sm" disabled={seedingPresets} onClick={handleSeedRolePresets}>
                <Sparkles className={cn('h-4 w-4 text-indigo-400', seedingPresets && 'animate-spin')} />
                {t('admin.seedPresetsBtn')}
              </Button>
              <Button size="sm" onClick={openCreateTemplateModal}>
                <Plus className="h-4 w-4" />
                {t('admin.newTemplateBtn')}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => openProvisionModalWithTemplate('agent-os')}>
              <Plus className="h-4 w-4" />
              {t('admin.provisionSandboxBtn')}
            </Button>
          )}
        </div>
      </div>

      {/* Consolidated Admin Section 1: Workforce & Templates */}
      {activeTab === 'workforce' && (
        <div className="space-y-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
            {(
              [
                ['sandboxes', t('admin.subtab.sandboxes')],
                ['templates', t('admin.subtab.templates')],
                ['playbooks', t('admin.subtab.playbooks')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setWorkforceSubTab(k)}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                  workforceSubTab === k
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {workforceSubTab === 'sandboxes' && (
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

          {workforceSubTab === 'templates' && (
            <TemplatesTab
              templates={templates}
              overview={overview}
              onProvisionWithTemplate={openProvisionModalWithTemplate}
              onEditTemplate={openEditTemplateModal}
              onDeleteTemplate={handleDeleteTemplate}
            />
          )}

          {workforceSubTab === 'playbooks' && (
            <PlaybooksView auth={auth} notify={notify} mode="admin-catalog" />
          )}
        </div>
      )}

      {/* Consolidated Admin Section 2: LLM Gateway */}
      {activeTab === 'llm' && (
        <LlmAndVaultTab
          llmProfiles={llmProfiles}
          sandboxes={sandboxes}
          onOpenCapabilities={(subTab) => {
            setCapSubTab(subTab)
            setActiveTab('capabilities')
          }}
          onRefresh={refreshAll}
          notify={notify}
        />
      )}

      {/* Consolidated Admin Section 3: Unified Capability Center (Plugins, Credentials, MCP, Skills) */}
      {activeTab === 'capabilities' && (
        <CapabilitiesView
          activeSubTab={capSubTab}
          onSelectSubTab={setCapSubTab}
          pluginsData={pluginsData}
          credentialProfiles={credentialProfiles}
          credentialPresets={credentialPresets}
          mcpServers={mcpServers}
          skills={skills}
          sandboxes={sandboxes}
          copiedKey={copiedKey}
          onCopy={copyText}
          onRefresh={refreshAll}
          notify={notify}
        />
      )}

      {/* Consolidated Admin Section 4: Users, Admins & SSO/Branding */}
      {activeTab === 'access' && (
        <div className="space-y-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
            {(
              [
                ['users', t('admin.subtab.users')],
                ['sso', t('admin.subtab.sso')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setAccessSubTab(k)}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                  accessSubTab === k
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {accessSubTab === 'users' && (
            <UsersTab
              users={users}
              admins={admins}
              overview={overview}
              enabledOidcCount={enabledOidcCount}
              effectiveAllowLocalUser={effectiveAllowLocalUser}
              onRefresh={refreshAll}
              onOpenAuditCenter={() => {
                setActiveTab('ops')
                setOpsSubTab('audit')
              }}
              notify={notify}
            />
          )}

          {accessSubTab === 'sso' && (
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
        </div>
      )}

      {/* Consolidated Admin Section 5: Platform Operations (Notifications, Audit) */}
      {activeTab === 'ops' && (
        <div className="space-y-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
            {(
              [
                ['notifications', t('admin.subtab.notifications')],
                ['audit', t('admin.subtab.audit')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOpsSubTab(k)}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                  opsSubTab === k
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {opsSubTab === 'notifications' && (
            <NotificationsTab sandboxes={sandboxes} notify={notify} />
          )}

          {opsSubTab === 'audit' && <AuditCenterTab notify={notify} />}
        </div>
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
        credentialProfiles={credentialProfiles}
        mcpServers={mcpServers}
        skills={skills}
        effectiveAllowLocalUser={effectiveAllowLocalUser}
        plugins={pluginsData?.items ?? []}
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
        plugins={pluginsData?.items ?? []}
        credentialProfiles={credentialProfiles}
        mcpServers={mcpServers}
        skills={skills}
      />

      <EditSandboxDialog
        target={editSbx}
        onClose={() => setEditSbx(null)}
        form={editSbxForm}
        setForm={setEditSbxForm}
        saving={savingSbx}
        onSubmit={handleSaveSandboxSpec}
        onRotateGatewayKey={handleRotateGatewayKey}
        llmProfiles={llmProfiles}
        credentialProfiles={credentialProfiles}
        mcpServers={mcpServers}
        skills={skills}
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
