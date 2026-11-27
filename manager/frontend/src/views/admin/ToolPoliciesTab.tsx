import React, { useCallback, useEffect, useState } from 'react'
import { Check, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
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
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type { SandboxItem, ToolApprovalRequestItem, ToolPolicyRuleItem } from '../../types'

export function ToolPoliciesTab({
  sandboxes,
  notify,
}: {
  sandboxes: SandboxItem[]
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const [rules, setRules] = useState<ToolPolicyRuleItem[]>([])
  const [approvals, setApprovals] = useState<ToolApprovalRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    tool_pattern: 'bash*',
    arg_regex: '',
    action: 'require_approval' as 'require_approval' | 'block' | 'audit',
    scope_sandbox_id: '',
    description: '',
    enabled: true,
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rulesRes, approvalsRes] = await Promise.all([
        apiFetch<{ items: ToolPolicyRuleItem[] }>('/api/tool-policies'),
        apiFetch<{ items: ToolApprovalRequestItem[] }>('/api/tool-approvals?limit=40'),
      ])
      setRules(rulesRes.items || [])
      setApprovals(approvalsRes.items || [])
    } catch (err: any) {
      notify(err.message || t('admin.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify, t])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.tool_pattern.trim()) return
    setSaving(true)
    try {
      await apiFetch('/api/tool-policies', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          enabled: form.enabled,
          tool_pattern: form.tool_pattern.trim(),
          arg_regex: form.arg_regex.trim() || null,
          action: form.action,
          scope_sandbox_id: form.scope_sandbox_id || null,
          description: form.description.trim() || null,
        }),
      })
      notify(t('policies.saved'))
      setModalOpen(false)
      setForm({
        name: '',
        tool_pattern: 'bash*',
        arg_regex: '',
        action: 'require_approval',
        scope_sandbox_id: '',
        description: '',
        enabled: true,
      })
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleRule = async (rule: ToolPolicyRuleItem) => {
    try {
      await apiFetch(`/api/tool-policies/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleDeleteRule = async (rule: ToolPolicyRuleItem) => {
    try {
      await apiFetch(`/api/tool-policies/${rule.id}`, { method: 'DELETE' })
      notify(t('policies.deleted'))
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const handleDecideApproval = async (
    req: ToolApprovalRequestItem,
    decision: 'approved' | 'rejected',
  ) => {
    try {
      await apiFetch(`/api/tool-approvals/${req.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: '' }),
      })
      notify(t('inbox.toolDecided', { decision }))
      await loadData()
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            <span>{t('policies.title')}</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">{t('policies.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t('policies.addBtn')}
        </Button>
      </div>

      {pendingApprovals.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-950/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              <span>{t('inbox.toolApprovalsTitle')}</span>
              <Badge variant="warning">{pendingApprovals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApprovals.map((req) => (
              <div
                key={req.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--brand-radius-sm)] border border-amber-500/30 bg-zinc-950/60 p-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-zinc-100">@{req.sandbox_slug}</span>
                    <Badge variant="warning">{req.tool_name}</Badge>
                    <span className="text-zinc-400">{req.rule_name}</span>
                  </div>
                  <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-900/70 rounded px-2 py-1 overflow-x-auto">
                    {req.tool_args_summary || '-'}
                  </pre>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="emerald"
                    onClick={() => void handleDecideApproval(req, 'approved')}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('inbox.toolApproveBtn')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                    onClick={() => void handleDecideApproval(req, 'rejected')}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t('inbox.toolRejectBtn')}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-800">
        <CardContent className="pt-5">
          {loading ? (
            <p className="text-xs text-zinc-500 py-6 text-center">{t('common.loading')}</p>
          ) : rules.length === 0 ? (
            <p className="text-xs text-zinc-500 py-8 text-center">{t('policies.empty')}</p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {rules.map((rule) => {
                const scopedSbx = rule.scope_sandbox_id
                  ? sandboxes.find((s) => s.id === rule.scope_sandbox_id)
                  : null
                return (
                  <div
                    key={rule.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-zinc-100">{rule.name}</span>
                        <Badge
                          variant={
                            rule.action === 'block'
                              ? 'destructive'
                              : rule.action === 'require_approval'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {rule.action}
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                          {rule.tool_pattern}
                        </Badge>
                        {rule.arg_regex && (
                          <Badge variant="outline" className="font-mono text-zinc-400">
                            /{rule.arg_regex}/
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {scopedSbx ? `@${scopedSbx.slug}` : t('policies.scopeGlobal')}
                        </Badge>
                      </div>
                      {rule.description && (
                        <p className="text-zinc-400">{rule.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant={rule.enabled ? 'outline' : 'ghost'}
                        onClick={() => void handleToggleRule(rule)}
                      >
                        {rule.enabled ? t('common.active') : t('common.disabled')}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-rose-400 hover:text-rose-300"
                        onClick={() => void handleDeleteRule(rule)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={modalOpen}
        onOpenChange={(o) => !o && !saving && setModalOpen(false)}
        title={t('policies.addBtn')}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>{t('policies.nameLabel')}</Label>
            <Input
              required
              placeholder={t('policies.namePh')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('policies.patternLabel')}</Label>
              <Input
                required
                className="font-mono text-xs"
                placeholder={t('policies.patternPh')}
                value={form.tool_pattern}
                onChange={(e) => setForm({ ...form, tool_pattern: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('policies.argRegexLabel')}</Label>
              <Input
                className="font-mono text-xs"
                placeholder={t('policies.argRegexPh')}
                value={form.arg_regex}
                onChange={(e) => setForm({ ...form, arg_regex: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('policies.actionLabel')}</Label>
              <Select
                value={form.action}
                onChange={(e) =>
                  setForm({
                    ...form,
                    action: e.target.value as 'require_approval' | 'block' | 'audit',
                  })
                }
              >
                <option value="require_approval">{t('policies.actionRequireApproval')}</option>
                <option value="block">{t('policies.actionBlock')}</option>
                <option value="audit">{t('policies.actionAudit')}</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('policies.scopeLabel')}</Label>
              <Select
                value={form.scope_sandbox_id}
                onChange={(e) => setForm({ ...form, scope_sandbox_id: e.target.value })}
              >
                <option value="">{t('policies.scopeGlobal')}</option>
                {sandboxes.map((s) => (
                  <option key={s.id} value={s.id}>
                    @{s.slug}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('policies.descLabel')}</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.add')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
