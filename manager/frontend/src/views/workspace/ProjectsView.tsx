import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  Check,
  Coins,
  Crown,
  Edit3,
  ExternalLink,
  FileUp,
  FolderKanban,
  LayoutGrid,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  AuthMe,
  ProvisionRequestItem,
  SandboxItem,
  TeamItem,
  TemplateItem,
} from '../../types'
import { DeliverablesView } from './DeliverablesView'
import { FinOpsView } from './FinOpsView'
import { MemoryHubSection } from './MemoryHubSection'
import { PlaybooksView } from './PlaybooksView'
import { ScorecardView } from './ScorecardView'

type ProjectDetailTab = 'workflows' | 'members' | 'knowledge' | 'deliverables' | 'cost'

function formatCost(v?: number | null): string {
  const n = Number(v || 0)
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n > 0) return `$${n.toFixed(4)}`
  return '$0.00'
}

export function ProjectsView({
  auth,
  notify,
  initialProjectId,
  onSelectProjectId,
}: {
  auth: AuthMe
  notify: (msg: string, type?: 'success' | 'error') => void
  initialProjectId?: string | null
  onSelectProjectId?: (projectId: string | null) => void
}) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  const [projects, setProjects] = useState<TeamItem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [requests, setRequests] = useState<ProvisionRequestItem[]>([])
  const [allSandboxes, setAllSandboxes] = useState<SandboxItem[]>([])
  const [loading, setLoading] = useState(true)

  // List filters
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected project workspace
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId || null)
  const [detailTab, setDetailTab] = useState<ProjectDetailTab>('workflows')
  const [costSubTab, setCostSubTab] = useState<'finops' | 'scorecard'>('finops')

  // Create / Edit project dialog
  const [projectDialogMode, setProjectDialogMode] = useState<'create' | 'edit' | null>(null)
  const [projectForm, setProjectForm] = useState({
    name: '',
    department: '',
    description: '',
    daily_token_budget: '',
    lead_emails: '',
    sandbox_ids: [] as string[],
  })
  const [savingProject, setSavingProject] = useState(false)

  // Project team member / sandbox attach drafts
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<'member' | 'lead'>('member')
  const [attachSandboxId, setAttachSandboxId] = useState('')
  const [syncingGroup, setSyncingGroup] = useState(false)

  // Project shared doc sync
  const [docForm, setDocForm] = useState({ file_name: 'PROJECT_BRIEF.md', content: '' })
  const [syncingDoc, setSyncingDoc] = useState(false)

  // Project hiring request dialog
  const [hireOpen, setHireOpen] = useState(false)
  const [hireForm, setHireForm] = useState({
    template_key: '',
    ownership_mode: 'shared' as 'personal' | 'shared',
    desired_slug: '',
    role_title: '',
    reason: '',
  })
  const [submittingHire, setSubmittingHire] = useState(false)
  const [decidingReqId, setDecidingReqId] = useState<string | null>(null)

  useEffect(() => {
    if (initialProjectId !== undefined) {
      setSelectedId(initialProjectId || null)
    }
  }, [initialProjectId])

  const selectProject = (id: string | null) => {
    setSelectedId(id)
    setDetailTab('workflows')
    onSelectProjectId?.(id)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const sbxEndpoint = auth.admin ? '/api/sandboxes' : '/api/my/sandboxes'
      const [projRes, tplRes, reqRes, sbxRes] = await Promise.all([
        apiFetch<{ items: TeamItem[] }>('/api/teams'),
        apiFetch<TemplateItem[]>('/api/workspace/templates').catch(() => [] as TemplateItem[]),
        apiFetch<{ items: ProvisionRequestItem[] }>('/api/provision-requests').catch(() => ({
          items: [] as ProvisionRequestItem[],
        })),
        apiFetch<{ items: SandboxItem[] }>(sbxEndpoint).catch(() => ({
          items: [] as SandboxItem[],
        })),
      ])
      setProjects(projRes.items || [])
      setTemplates(tplRes || [])
      setRequests(reqRes.items || [])
      setAllSandboxes(sbxRes.items || [])
    } catch (err: any) {
      notify(err.message || tRef.current('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [auth.admin, notify])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId || p.slug === selectedId) || null,
    [projects, selectedId],
  )

  const projectSandboxes = useMemo(() => {
    if (!selectedProject) return [] as SandboxItem[]
    const ids = new Set(selectedProject.sandboxes.map((s) => s.id))
    return allSandboxes.filter((s) => ids.has(s.id))
  }, [allSandboxes, selectedProject])

  const availableSandboxesToAttach = useMemo(() => {
    if (!selectedProject) return [] as SandboxItem[]
    const attached = new Set(selectedProject.sandboxes.map((s) => s.id))
    return allSandboxes.filter((s) => !attached.has(s.id))
  }, [allSandboxes, selectedProject])

  const projectRequests = useMemo(() => {
    if (!selectedProject) return [] as ProvisionRequestItem[]
    return requests.filter((r) => r.team_id === selectedProject.id)
  }, [requests, selectedProject])

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return projects.filter((p) => {
      const st = p.status || 'active'
      if (st !== statusFilter) return false
      if (!q) return true
      const hay = `${p.name} ${p.slug} ${p.department || ''} ${p.description || ''} ${p.sandboxes.map((s) => s.slug).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [projects, searchQuery, statusFilter])

  const activeCount = projects.filter((p) => (p.status || 'active') === 'active').length
  const archivedCount = projects.filter((p) => p.status === 'archived').length

  const openCreateDialog = () => {
    setProjectForm({
      name: '',
      department: '',
      description: '',
      daily_token_budget: '',
      lead_emails: '',
      sandbox_ids: [],
    })
    setProjectDialogMode('create')
  }

  const openEditDialog = (proj: TeamItem) => {
    setProjectForm({
      name: proj.name,
      department: proj.department || '',
      description: proj.description || '',
      daily_token_budget: proj.daily_token_budget ? String(proj.daily_token_budget) : '',
      lead_emails: '',
      sandbox_ids: [],
    })
    setProjectDialogMode('edit')
  }

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProject(true)
    try {
      const budget = projectForm.daily_token_budget.trim()
        ? Math.max(0, Number.parseInt(projectForm.daily_token_budget.trim(), 10) || 0)
        : null
      if (projectDialogMode === 'edit' && selectedProject) {
        await apiFetch(`/api/teams/${selectedProject.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: projectForm.name.trim(),
            department: projectForm.department.trim(),
            description: projectForm.description.trim(),
            daily_token_budget: budget ?? 0,
          }),
        })
        notify(t('projects.updated'))
      } else {
        const leads = projectForm.lead_emails
          .split(/[\s,;]+/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
        const created = await apiFetch<TeamItem>('/api/teams', {
          method: 'POST',
          body: JSON.stringify({
            name: projectForm.name.trim(),
            department: projectForm.department.trim() || null,
            description: projectForm.description.trim() || null,
            daily_token_budget: budget,
            lead_emails: leads,
            sandbox_ids: projectForm.sandbox_ids,
          }),
        })
        notify(t('projects.created'))
        setProjectDialogMode(null)
        await loadAll()
        selectProject(created.id)
        return
      }
      setProjectDialogMode(null)
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSavingProject(false)
    }
  }

  const handleToggleArchive = async (proj: TeamItem) => {
    const nextStatus = proj.status === 'archived' ? 'active' : 'archived'
    try {
      await apiFetch(`/api/teams/${proj.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      notify(nextStatus === 'archived' ? t('projects.archivedOk') : t('projects.restoredOk'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleDeleteProject = async (proj: TeamItem) => {
    if (!window.confirm(t('projects.deleteConfirm', { name: proj.name }))) return
    try {
      await apiFetch(`/api/teams/${proj.id}`, { method: 'DELETE' })
      notify(t('projects.deleted'))
      selectProject(null)
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !memberEmail.trim()) return
    try {
      await apiFetch(`/api/teams/${selectedProject.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: memberEmail.trim(), role: memberRole }),
      })
      setMemberEmail('')
      notify(t('projects.memberAdded'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleRemoveMember = async (email: string) => {
    if (!selectedProject) return
    try {
      await apiFetch(`/api/teams/${selectedProject.id}/members/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      })
      notify(t('projects.memberRemoved'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleAttachSandbox = async () => {
    if (!selectedProject || !attachSandboxId) return
    try {
      await apiFetch(`/api/teams/${selectedProject.id}/sandboxes`, {
        method: 'POST',
        body: JSON.stringify({ sandbox_id: attachSandboxId }),
      })
      setAttachSandboxId('')
      notify(t('projects.employeeAttached'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleDetachSandbox = async (sandboxId: string) => {
    if (!selectedProject) return
    try {
      await apiFetch(`/api/teams/${selectedProject.id}/sandboxes/${sandboxId}`, {
        method: 'DELETE',
      })
      notify(t('projects.employeeDetached'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleSetModerator = async (sandboxId: string) => {
    if (!selectedProject) return
    try {
      await apiFetch(`/api/teams/${selectedProject.id}/sandboxes`, {
        method: 'POST',
        body: JSON.stringify({ sandbox_id: sandboxId, is_moderator: true }),
      })
      notify(t('projects.moderatorUpdated'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleSyncGroup = async () => {
    if (!selectedProject) return
    setSyncingGroup(true)
    try {
      const res = await apiFetch<{ sync: { ok: boolean; synced?: number; total?: number; detail?: string } }>(
        `/api/teams/${selectedProject.id}/sync-group`,
        { method: 'POST' },
      )
      if (res.sync?.ok) {
        notify(
          t('projects.groupSyncedOk', {
            synced: res.sync.synced ?? selectedProject.sandboxes.length,
            total: res.sync.total ?? selectedProject.sandboxes.length,
          }),
        )
      } else {
        notify(res.sync?.detail || t('projects.groupSyncSkipped'), 'error')
      }
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSyncingGroup(false)
    }
  }

  const handleSyncDoc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !docForm.content.trim()) return
    setSyncingDoc(true)
    try {
      const res = await apiFetch<{ synced: number; total: number }>(
        `/api/teams/${selectedProject.id}/shared-docs`,
        {
          method: 'POST',
          body: JSON.stringify({
            file_name: docForm.file_name.trim() || 'PROJECT_BRIEF.md',
            content: docForm.content,
          }),
        },
      )
      notify(t('teams.docSynced', { synced: res.synced, total: res.total }))
      setDocForm({ file_name: 'PROJECT_BRIEF.md', content: '' })
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSyncingDoc(false)
    }
  }

  const openHireDialog = () => {
    const firstTpl = templates[0]
    setHireForm({
      template_key: firstTpl?.key || '',
      ownership_mode: 'shared',
      desired_slug: '',
      role_title: firstTpl?.role_title || firstTpl?.name || '',
      reason: '',
    })
    setHireOpen(true)
  }

  const handleSubmitHire = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !hireForm.template_key) return
    setSubmittingHire(true)
    try {
      await apiFetch('/api/provision-requests', {
        method: 'POST',
        body: JSON.stringify({
          template_key: hireForm.template_key,
          team_id: selectedProject.id,
          ownership_mode: hireForm.ownership_mode,
          desired_slug: hireForm.desired_slug.trim() || null,
          role_title: hireForm.role_title.trim() || null,
          reason: hireForm.reason.trim() || null,
        }),
      })
      notify(t('projects.hireSubmitted'))
      setHireOpen(false)
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSubmittingHire(false)
    }
  }

  const handleDecideHire = async (reqId: string, decision: 'approved' | 'rejected') => {
    setDecidingReqId(reqId)
    try {
      await apiFetch(`/api/provision-requests/${reqId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      notify(decision === 'approved' ? t('projects.hireApproved') : t('projects.hireRejected'))
      await loadAll()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setDecidingReqId(null)
    }
  }

  // =========================================================================
  // LEVEL 2: SINGLE PROJECT WORKSPACE (5-Tab Hub)
  // =========================================================================
  if (selectedProject) {
    const isArchived = selectedProject.status === 'archived'
    const tabs: Array<{
      key: ProjectDetailTab
      label: string
      icon: React.ComponentType<{ className?: string }>
      badge?: number
    }> = [
      {
        key: 'workflows',
        label: t('projects.tabWorkflows'),
        icon: BookOpen,
        badge: selectedProject.active_runs_count || undefined,
      },
      {
        key: 'members',
        label: t('projects.tabMembers'),
        icon: Users,
        badge: selectedProject.sandboxes.length + selectedProject.members.length,
      },
      {
        key: 'knowledge',
        label: t('projects.tabKnowledge'),
        icon: Sparkles,
      },
      {
        key: 'deliverables',
        label: t('projects.tabDeliverables'),
        icon: LayoutGrid,
      },
      ...(selectedProject.can_manage
        ? [
            {
              key: 'cost' as const,
              label: t('projects.tabCost'),
              icon: Coins,
            },
          ]
        : []),
    ]

    return (
      <div className="space-y-6">
        {/* Project Header */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 border-b border-zinc-800 pb-5">
          <div className="space-y-2 min-w-0">
            <button
              type="button"
              onClick={() => selectProject(null)}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{t('projects.backToList')}</span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <FolderKanban className="h-6 w-6 text-indigo-400 shrink-0" />
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                {selectedProject.name}
              </h1>
              <Badge variant={isArchived ? 'outline' : 'success'}>
                {isArchived ? t('projects.statusArchived') : t('projects.statusActive')}
              </Badge>
              {selectedProject.department && (
                <Badge variant="outline">
                  <Building2 className="h-3 w-3 mr-1" />
                  {selectedProject.department}
                </Badge>
              )}
              {selectedProject.my_role && (
                <Badge variant="secondary" className="text-[11px]">
                  <Shield className="h-3 w-3 mr-1" />
                  {selectedProject.my_role}
                </Badge>
              )}
              {selectedProject.sandboxes.length >= 2 && (
                <Badge
                  variant={selectedProject.mesh_room_id ? 'success' : 'outline'}
                  className="text-[11px]"
                >
                  <MessageSquare className="h-3 w-3 mr-1" />
                  {selectedProject.mesh_room_id
                    ? t('projects.groupReadyBadge')
                    : t('projects.groupPendingBadge')}
                </Badge>
              )}
            </div>
            {selectedProject.description && (
              <p className="text-sm text-zinc-400 max-w-3xl">{selectedProject.description}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            {selectedProject.can_manage && (
              <>
                <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedProject)}>
                  <Edit3 className="h-4 w-4" />
                  {t('common.edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleToggleArchive(selectedProject)}
                >
                  {isArchived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4 text-emerald-400" />
                      {t('projects.restoreBtn')}
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4 text-amber-400" />
                      {t('projects.archiveBtn')}
                    </>
                  )}
                </Button>
              </>
            )}
            {auth.admin && (
              <Button
                variant="outline"
                size="sm"
                className="text-rose-400 hover:text-rose-300"
                onClick={() => void handleDeleteProject(selectedProject)}
              >
                <Trash2 className="h-4 w-4" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>

        {/* 5 Project Workspace Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800/80 pb-3">
          {tabs.map((tb) => {
            const Icon = tb.icon
            const active = detailTab === tb.key
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setDetailTab(tb.key)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer',
                  active
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tb.label}</span>
                {tb.badge != null && tb.badge > 0 && (
                  <Badge variant={active ? 'secondary' : 'outline'} className="text-[11px]">
                    {tb.badge}
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        {/* Tab 1: Workflows & Playbooks */}
        {detailTab === 'workflows' && (
          <PlaybooksView
            auth={auth}
            notify={notify}
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            projectMeshRoomId={selectedProject.mesh_room_id}
            projectSandboxes={projectSandboxes}
          />
        )}

        {/* Tab 2: Project Team (Digital Employees + Human Members + Hiring) */}
        {detailTab === 'members' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Digital Employees Card */}
              <Card className="border-zinc-800">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-4 w-4 text-indigo-400" />
                    <span>{t('projects.digitalEmployeesTitle')}</span>
                    <Badge variant="outline">{selectedProject.sandboxes.length}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {selectedProject.can_manage && selectedProject.sandboxes.length >= 2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={syncingGroup}
                        onClick={() => void handleSyncGroup()}
                        title={t('projects.syncGroupHint')}
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', syncingGroup && 'animate-spin')} />
                        {t('projects.syncGroupBtn')}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={openHireDialog}>
                      <Briefcase className="h-3.5 w-3.5" />
                      {t('projects.requestHireBtn')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedProject.sandboxes.length === 0 ? (
                    <div className="rounded-[var(--brand-radius-sm)] border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                      {t('projects.noEmployeesHint')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedProject.sandboxes.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full shrink-0',
                                s.status === 'running' ? 'bg-emerald-400' : 'bg-zinc-600',
                              )}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-medium text-zinc-100 truncate">
                                <span className="truncate">{s.display_name || s.slug}</span>
                                <span className="font-mono text-zinc-500">@{s.slug}</span>
                                {s.is_moderator && (
                                  <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                                    <Crown className="h-2.5 w-2.5 mr-0.5" />
                                    {t('projects.moderatorBadge')}
                                  </Badge>
                                )}
                              </div>
                              {s.role_title && (
                                <div className="text-[11px] text-zinc-400 truncate">
                                  {s.role_title}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {selectedProject.can_manage &&
                              selectedProject.sandboxes.length >= 2 &&
                              !s.is_moderator && (
                                <button
                                  type="button"
                                  onClick={() => void handleSetModerator(s.id)}
                                  title={t('projects.setModeratorBtn')}
                                  className="p-1 text-zinc-500 hover:text-amber-400 cursor-pointer"
                                >
                                  <Crown className="h-3.5 w-3.5" />
                                </button>
                              )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => window.open(`/sandboxes/${s.id}/open`, '_blank')}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {t('playbooks.openWorkspaceBtn')}
                            </Button>
                            {selectedProject.can_manage && (
                              <button
                                type="button"
                                onClick={() => void handleDetachSandbox(s.id)}
                                title={t('common.delete')}
                                className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedProject.can_manage && availableSandboxesToAttach.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/70">
                      <Select
                        value={attachSandboxId}
                        onChange={(e) => setAttachSandboxId(e.target.value)}
                        className="h-8 text-xs flex-1"
                      >
                        <option value="">{t('projects.selectEmployeePlaceholder')}</option>
                        {availableSandboxesToAttach.map((s) => (
                          <option key={s.id} value={s.id}>
                            @{s.slug} {s.role_title ? `· ${s.role_title}` : ''} ({s.status})
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!attachSandboxId}
                        onClick={() => void handleAttachSandbox()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('projects.attachBtn')}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Human Members Card */}
              <Card className="border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-sky-400" />
                    <span>{t('projects.humanMembersTitle')}</span>
                    <Badge variant="outline">{selectedProject.members.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedProject.members.length === 0 ? (
                    <div className="rounded-[var(--brand-radius-sm)] border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                      {t('projects.noMembersHint')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedProject.members.map((m) => (
                        <div
                          key={m.email}
                          className="flex items-center justify-between gap-2 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-zinc-200 truncate">{m.email}</span>
                            <Badge variant={m.role === 'lead' ? 'warning' : 'outline'}>
                              {m.role === 'lead' ? t('projects.roleLead') : t('projects.roleMember')}
                            </Badge>
                          </div>
                          {selectedProject.can_manage && (
                            <button
                              type="button"
                              onClick={() => void handleRemoveMember(m.email)}
                              className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedProject.can_manage && (
                    <form
                      onSubmit={handleAddMember}
                      className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/70"
                    >
                      <Input
                        type="email"
                        required
                        placeholder="colleague@corp.com"
                        value={memberEmail}
                        onChange={(e) => setMemberEmail(e.target.value)}
                        className="h-8 text-xs flex-1 min-w-[180px]"
                      />
                      <Select
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value as 'member' | 'lead')}
                        className="h-8 text-xs w-28"
                      >
                        <option value="member">{t('projects.roleMember')}</option>
                        <option value="lead">{t('projects.roleLead')}</option>
                      </Select>
                      <Button type="submit" size="sm" className="h-8 text-xs">
                        <UserPlus className="h-3.5 w-3.5" />
                        {t('common.add')}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Project Hiring Requests */}
            {projectRequests.length > 0 && (
              <Card className="border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-amber-400" />
                    <span>{t('projects.hiringRequestsTitle')}</span>
                    <Badge variant="outline">{projectRequests.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {projectRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-sm)] border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 font-medium text-zinc-100">
                          <span>{req.role_title || req.template_name}</span>
                          <Badge
                            variant={
                              req.status === 'approved'
                                ? 'success'
                                : req.status === 'rejected'
                                  ? 'destructive'
                                  : 'warning'
                            }
                          >
                            {req.status}
                          </Badge>
                          <span className="font-mono text-zinc-400">{req.requester_email}</span>
                        </div>
                        {req.reason && <div className="text-zinc-400">{req.reason}</div>}
                      </div>
                      {req.status === 'pending' && selectedProject.can_manage && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={decidingReqId === req.id}
                            onClick={() => void handleDecideHire(req.id, 'approved')}
                          >
                            <Check className="h-3 w-3" />
                            {t('projects.approveBtn')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-rose-400"
                            disabled={decidingReqId === req.id}
                            onClick={() => void handleDecideHire(req.id, 'rejected')}
                          >
                            <X className="h-3 w-3" />
                            {t('projects.rejectBtn')}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Tab 3: Knowledge & Memory */}
        {detailTab === 'knowledge' && (
          <div className="space-y-6">
            {selectedProject.can_manage && (
              <Card className="border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileUp className="h-4 w-4 text-indigo-400" />
                    <span>{t('projects.sharedDocTitle')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSyncDoc} className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('projects.docFileName')}</Label>
                        <Input
                          required
                          value={docForm.file_name}
                          onChange={(e) => setDocForm({ ...docForm, file_name: e.target.value })}
                          placeholder="PROJECT_BRIEF.md"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('projects.docContent')}</Label>
                      <Textarea
                        rows={5}
                        required
                        value={docForm.content}
                        onChange={(e) => setDocForm({ ...docForm, content: e.target.value })}
                        placeholder={t('projects.sharedDocPlaceholder')}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-500">
                        {t('projects.sharedDocDirHint', {
                          slug: selectedProject.slug,
                          count: selectedProject.sandboxes.length,
                        })}
                      </span>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={syncingDoc || selectedProject.sandboxes.length === 0}
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        {syncingDoc ? t('common.saving') : t('projects.syncDocBtn')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <MemoryHubSection
              auth={auth}
              sandboxes={projectSandboxes}
              teams={[selectedProject]}
              templates={templates}
              notify={notify}
            />
          </div>
        )}

        {/* Tab 4: Deliverables */}
        {detailTab === 'deliverables' && (
          <DeliverablesView auth={auth} notify={notify} projectId={selectedProject.id} compact />
        )}

        {/* Tab 5: Project Cost & ROI */}
        {detailTab === 'cost' && selectedProject.can_manage && (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1">
              <button
                type="button"
                onClick={() => setCostSubTab('finops')}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  costSubTab === 'finops'
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {t('analytics.tabFinops')}
              </button>
              <button
                type="button"
                onClick={() => setCostSubTab('scorecard')}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  costSubTab === 'scorecard'
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {t('analytics.tabScorecard')}
              </button>
            </div>
            {costSubTab === 'finops' ? (
              <FinOpsView notify={notify} fixedTeamId={selectedProject.id} compact />
            ) : (
              <ScorecardView notify={notify} fixedTeamId={selectedProject.id} compact />
            )}
          </div>
        )}

        {/* Edit Project Dialog */}
        <Dialog
          open={projectDialogMode === 'edit'}
          onOpenChange={(o) => !o && !savingProject && setProjectDialogMode(null)}
          title={t('projects.editDialogTitle')}
        >
          <form onSubmit={handleSaveProject} className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>{t('projects.nameLabel')}</Label>
              <Input
                required
                value={projectForm.name}
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('projects.deptLabel')}</Label>
                <Input
                  value={projectForm.department}
                  onChange={(e) => setProjectForm({ ...projectForm, department: e.target.value })}
                  placeholder={t('projects.deptPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('projects.budgetLabel')}</Label>
                <Input
                  type="number"
                  min={0}
                  value={projectForm.daily_token_budget}
                  onChange={(e) =>
                    setProjectForm({ ...projectForm, daily_token_budget: e.target.value })
                  }
                  placeholder="2000000"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('projects.descLabel')}</Label>
              <Textarea
                rows={3}
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setProjectDialogMode(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={savingProject}>
                {savingProject ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Project Hiring Request Dialog */}
        <Dialog
          open={hireOpen}
          onOpenChange={(o) => !o && !submittingHire && setHireOpen(false)}
          title={t('projects.hireDialogTitle', { project: selectedProject.name })}
        >
          <form onSubmit={handleSubmitHire} className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.templateLabel')}</Label>
              <Select
                required
                value={hireForm.template_key}
                onChange={(e) => {
                  const tpl = templates.find((x) => x.key === e.target.value)
                  setHireForm({
                    ...hireForm,
                    template_key: e.target.value,
                    role_title: tpl?.role_title || tpl?.name || hireForm.role_title,
                  })
                }}
              >
                {templates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.name} ({tpl.key})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('dialog.provision.roleTitleLabel')}</Label>
                <Input
                  value={hireForm.role_title}
                  onChange={(e) => setHireForm({ ...hireForm, role_title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('dialog.provision.slugLabel')}</Label>
                <Input
                  value={hireForm.desired_slug}
                  onChange={(e) => setHireForm({ ...hireForm, desired_slug: e.target.value })}
                  placeholder={t('dialog.provision.slugPlaceholder')}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('projects.hireReasonLabel')}</Label>
              <Textarea
                rows={2}
                value={hireForm.reason}
                onChange={(e) => setHireForm({ ...hireForm, reason: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={() => setHireOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submittingHire}>
                {submittingHire ? t('common.saving') : t('projects.hireSubmitBtn')}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    )
  }

  // =========================================================================
  // LEVEL 1: PROJECT DIRECTORY (/projects)
  // =========================================================================
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            {t('projects.title')}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">{t('projects.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadAll()}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            {t('projects.createBtn')}
          </Button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/70 p-1 self-start">
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              statusFilter === 'active'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            <span>{t('projects.filterActive')}</span>
            <Badge variant="outline">{activeCount}</Badge>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className={cn(
              'inline-flex items-center gap-2 rounded-[var(--brand-radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              statusFilter === 'archived'
                ? 'brand-tab-active'
                : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            <span>{t('projects.filterArchived')}</span>
            <Badge variant="outline">{archivedCount}</Badge>
          </button>
        </div>

        <div className="relative min-w-[240px]">
          <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            className="pl-9 h-9 text-xs"
            placeholder={t('projects.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Project Cards Grid */}
      {filteredProjects.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="py-16 text-center space-y-3">
            <FolderKanban className="h-10 w-10 text-zinc-500 mx-auto" />
            <div className="text-base font-medium text-zinc-200">
              {statusFilter === 'archived' ? t('projects.archivedEmpty') : t('projects.emptyTitle')}
            </div>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              {statusFilter === 'archived'
                ? t('projects.archivedEmptyHint')
                : t('projects.emptyDesc')}
            </p>
            {statusFilter === 'active' && (
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                {t('projects.createFirstBtn')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProjects.map((proj) => {
            const runningCount = proj.sandboxes.filter((s) => s.status === 'running').length
            const pendingCount = proj.pending_approvals_count || 0
            const activeRuns = proj.active_runs_count || 0
            return (
              <Card
                key={proj.id}
                onClick={() => selectProject(proj.id)}
                className="border-zinc-800 hover:border-indigo-500/50 transition-colors cursor-pointer flex flex-col justify-between group"
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderKanban className="h-5 w-5 text-indigo-400 shrink-0" />
                      <CardTitle className="text-base truncate group-hover:text-indigo-300 transition-colors">
                        {proj.name}
                      </CardTitle>
                    </div>
                    {pendingCount > 0 ? (
                      <Badge variant="warning" className="shrink-0">
                        {t('projects.pendingBadge', { count: pendingCount })}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[11px]">
                        {proj.status === 'archived'
                          ? t('projects.statusArchived')
                          : t('projects.statusActive')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {proj.department && (
                      <Badge variant="secondary" className="text-[11px]">
                        <Building2 className="h-3 w-3 mr-1" />
                        {proj.department}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[11px]">
                      <Users className="h-3 w-3 mr-1" />
                      {proj.members.length}
                    </Badge>
                    <Badge variant="outline" className="text-[11px]">
                      <Bot className="h-3 w-3 mr-1" />
                      {runningCount}/{proj.sandboxes.length}
                    </Badge>
                  </div>
                  {proj.description && (
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                      {proj.description}
                    </p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Employee chips */}
                  {proj.sandboxes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {proj.sandboxes.slice(0, 5).map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              s.status === 'running' ? 'bg-emerald-400' : 'bg-zinc-600',
                            )}
                          />
                          @{s.slug}
                        </span>
                      ))}
                      {proj.sandboxes.length > 5 && (
                        <span className="text-[11px] text-zinc-500">
                          +{proj.sandboxes.length - 5}
                        </span>
                      )}
                    </div>
                  )}

                  {/* KPI footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-zinc-800/70 text-xs text-zinc-400">
                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <span>
                        {t('projects.cardActiveRuns', { count: activeRuns })}
                      </span>
                      <span>·</span>
                      <span>{formatCost(proj.period_cost_usd)}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-indigo-400 font-medium group-hover:translate-x-0.5 transition-transform">
                      {t('projects.enterBtn')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Project Dialog */}
      <Dialog
        open={projectDialogMode === 'create'}
        onOpenChange={(o) => !o && !savingProject && setProjectDialogMode(null)}
        title={t('projects.createDialogTitle')}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSaveProject} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('projects.nameLabel')}</Label>
              <Input
                required
                placeholder={t('projects.namePlaceholder')}
                value={projectForm.name}
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('projects.deptLabel')}</Label>
              <Input
                placeholder={t('projects.deptPlaceholder')}
                value={projectForm.department}
                onChange={(e) => setProjectForm({ ...projectForm, department: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('projects.descLabel')}</Label>
            <Textarea
              rows={2}
              placeholder={t('projects.descPlaceholder')}
              value={projectForm.description}
              onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
            />
          </div>

          {/* Multi-select Digital Employees from pool */}
          {allSandboxes.length > 0 && (
            <div className="space-y-2">
              <Label>{t('projects.pickEmployeesLabel')}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-1">
                {allSandboxes.map((s) => {
                  const checked = projectForm.sandbox_ids.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setProjectForm((prev) => ({
                          ...prev,
                          sandbox_ids: checked
                            ? prev.sandbox_ids.filter((id) => id !== s.id)
                            : [...prev.sandbox_ids, s.id],
                        }))
                      }
                      className={cn(
                        'flex items-center gap-2 rounded-[var(--brand-radius-sm)] border px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                        checked
                          ? 'border-indigo-500/70 bg-indigo-500/10 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600',
                      )}
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                          checked
                            ? 'border-indigo-500 bg-indigo-500 text-white'
                            : 'border-zinc-600',
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {s.display_name || s.slug}{' '}
                          <span className="font-mono text-zinc-500">@{s.slug}</span>
                        </div>
                        {s.role_title && (
                          <div className="truncate text-[11px] text-zinc-400">{s.role_title}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('projects.budgetLabel')}</Label>
              <Input
                type="number"
                min={0}
                placeholder="2000000"
                value={projectForm.daily_token_budget}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, daily_token_budget: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('projects.extraLeadsLabel')}</Label>
              <Input
                placeholder="lead@corp.com"
                value={projectForm.lead_emails}
                onChange={(e) => setProjectForm({ ...projectForm, lead_emails: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setProjectDialogMode(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingProject}>
              <Plus className="h-4 w-4" />
              {savingProject ? t('common.saving') : t('projects.createBtn')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
