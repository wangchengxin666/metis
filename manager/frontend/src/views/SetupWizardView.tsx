import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Cpu,
  Download,
  Globe2,
  Hammer,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  cn,
} from '../components/ui'
import { apiFetch } from '../lib/client.ts'
import { useI18n } from '../lib/i18nContext'
import type { ImageBuildJobItem, LlmProfileItem, SetupStatusData } from '../types'

export function SetupWizardView({
  onSetupCompleted,
  onDone,
  notify,
}: {
  onSetupCompleted: () => Promise<void>
  onDone: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const [statusData, setStatusData] = useState<SetupStatusData | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1 state
  const [setupCode, setSetupCode] = useState('')
  const [adminEmail, setAdminEmail] = useState('admin@example.com')
  const [adminName, setAdminName] = useState('Platform Admin')
  const [adminPw, setAdminPw] = useState('')
  const [adminPwConfirm, setAdminPwConfirm] = useState('')
  const [brandName, setBrandName] = useState('Metis Digital Workforce')
  const [networkPreset, setNetworkPreset] = useState<'direct' | 'cn-aliyun' | 'custom'>('direct')
  const [customAptMirror, setCustomAptMirror] = useState('https://mirrors.aliyun.com')
  const [customPipIndex, setCustomPipIndex] = useState('https://mirrors.aliyun.com/pypi/simple/')
  const [customNpmRegistry, setCustomNpmRegistry] = useState('https://registry.npmmirror.com')
  const [customDockerMirror, setCustomDockerMirror] = useState('')
  const [allowLocalUsers, setAllowLocalUsers] = useState(true)
  const [submitting1, setSubmitting1] = useState(false)

  // Step 2 state
  const [installBrowser, setInstallBrowser] = useState(false)
  const [activeJob, setActiveJob] = useState<ImageBuildJobItem | null>(null)
  const [startingImgJob, setStartingImgJob] = useState(false)

  // Step 3 state
  const [llmName, setLlmName] = useState('Default LLM')
  const [llmProtocol, setLlmProtocol] = useState('openai-completions')
  const [llmBaseUrl, setLlmBaseUrl] = useState('https://api.openai.com/v1')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('gpt-4o')
  const [savingLlm, setSavingLlm] = useState(false)
  const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const refreshStatus = async () => {
    try {
      const s = await apiFetch<SetupStatusData>('/api/setup/status')
      setStatusData(s)
      if (s.default_admin_email && adminEmail === 'admin@example.com') {
        setAdminEmail(s.default_admin_email)
      }
      if (s.setup_completed) {
        if (s.onboarding_step === 'llm') setStep(3)
        else if (s.onboarding_step === 'images') setStep(2)
      }
    } catch {
      // ignore transient poll failures
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  // Poll image job if running in Step 2
  useEffect(() => {
    if (!activeJob || !['pending', 'running'].includes(activeJob.status)) return
    const timer = window.setInterval(async () => {
      try {
        const latest = await apiFetch<ImageBuildJobItem>(
          `/api/images/jobs/${encodeURIComponent(activeJob.id)}`,
        )
        setActiveJob(latest)
        if (latest.status === 'succeeded') {
          await refreshStatus()
          notify(latest.image_repo + ':' + latest.image_tag)
        } else if (latest.status === 'failed') {
          notify(latest.error_message || 'Image job failed', 'error')
        }
      } catch {
        // ignore poll error
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [activeJob, notify])

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (adminPw !== adminPwConfirm) {
      notify(t('setup.pwMismatch'), 'error')
      return
    }
    setSubmitting1(true)
    try {
      const res = await apiFetch<{
        setup_completed: boolean
        onboarding_step: string
        base_image_present: boolean
      }>('/api/setup/complete', {
        method: 'POST',
        body: JSON.stringify({
          setup_code: setupCode.trim(),
          admin_email: adminEmail.trim(),
          admin_password: adminPw,
          admin_display_name: adminName.trim() || null,
          brand_name_zh: brandName.trim() || null,
          brand_name_en: brandName.trim() || null,
          network_preset: networkPreset,
          ...(networkPreset === 'custom'
            ? {
                docker_registry_mirror: customDockerMirror.trim(),
                apt_mirror: customAptMirror.trim(),
                npm_registry: customNpmRegistry.trim(),
                pip_index_url: customPipIndex.trim(),
              }
            : {}),
          allow_local_user_login: allowLocalUsers,
        }),
      })
      await onSetupCompleted()
      await refreshStatus()
      setStep(res.base_image_present ? 3 : 2)
      notify(t('login.success'))
    } catch (err: any) {
      notify(err.message || 'Setup failed', 'error')
    } finally {
      setSubmitting1(false)
    }
  }

  const startStep2Job = async (kind: 'pull' | 'base') => {
    if (!statusData) return
    setStartingImgJob(true)
    try {
      const endpoint = kind === 'pull' ? '/api/images/pull' : '/api/images/build-base'
      const body =
        kind === 'pull'
          ? {
              image_repo: statusData.default_image_repo,
              image_tag: statusData.default_image_tag,
            }
          : {
              image_repo: statusData.default_image_repo,
              image_tag: statusData.default_image_tag,
              install_browser: installBrowser,
            }
      const job = await apiFetch<ImageBuildJobItem>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setActiveJob(job)
      notify(t('infra.jobSubmitted', { job: job.job_key }))
    } catch (err: any) {
      notify(err.message || 'Failed to start image job', 'error')
    } finally {
      setStartingImgJob(false)
    }
  }

  const advanceOnboarding = async (targetStep: 'llm' | 'done') => {
    try {
      await apiFetch('/api/setup/onboarding-step', {
        method: 'POST',
        body: JSON.stringify({ onboarding_step: targetStep }),
      })
    } catch {
      // non-fatal
    }
    if (targetStep === 'llm') {
      setStep(3)
    } else {
      await onDone()
    }
  }

  const handleSaveAndTestLlm = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingLlm(true)
    setLlmTestResult(null)
    try {
      const created = await apiFetch<LlmProfileItem>('/api/llm-profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: llmName.trim(),
          api_protocol: llmProtocol,
          base_url: llmBaseUrl.trim(),
          api_key: llmApiKey.trim(),
          model: llmModel.trim(),
          gateway_enabled: true,
        }),
      })
      const testRes = await apiFetch<{ ok: boolean; detail?: string }>(
        `/api/llm-profiles/${encodeURIComponent(created.id)}/test`,
        { method: 'POST' },
      )
      setLlmTestResult({ ok: Boolean(testRes.ok), detail: testRes.detail || '' })
      notify(testRes.ok ? t('setup.testOk') : t('setup.testFail', { detail: testRes.detail || '' }), testRes.ok ? 'success' : 'error')
    } catch (err: any) {
      setLlmTestResult({ ok: false, detail: err.message })
      notify(err.message || 'LLM error', 'error')
    } finally {
      setSavingLlm(false)
    }
  }

  const baseImageFull = statusData
    ? `${statusData.default_image_repo}:${statusData.default_image_tag}`
    : 'dsh-sandbox:latest'

  return (
    <div className="mx-auto max-w-3xl py-4 space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{t('setup.title')}</h1>
      </div>

      {/* Stepper bar */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { num: 1 as const, label: t('setup.step1Title'), icon: KeyRound },
          { num: 2 as const, label: t('setup.step2Title'), icon: Hammer },
          { num: 3 as const, label: t('setup.step3Title'), icon: Cpu },
        ].map((item) => {
          const Icon = item.icon
          const active = step === item.num
          const done = step > item.num
          return (
            <div
              key={item.num}
              className={cn(
                'flex items-center gap-2 rounded-[var(--brand-radius-md)] border px-3 py-2.5 text-xs font-medium',
                active
                  ? 'border-indigo-500/60 bg-indigo-950/35 text-indigo-100'
                  : done
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-500',
              )}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <Icon className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{item.label}</span>
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-400" />
              {t('setup.step1Title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep1Submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('setup.codeLabel')}</Label>
                <Input
                  required
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value)}
                  placeholder={t('setup.codePh')}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('setup.adminEmailLabel')}</Label>
                  <Input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.adminNameLabel')}</Label>
                  <Input
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.adminPwLabel')}</Label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={adminPw}
                    onChange={(e) => setAdminPw(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.adminPwConfirmLabel')}</Label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={adminPwConfirm}
                    onChange={(e) => setAdminPwConfirm(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('setup.brandLabel')}</Label>
                  <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Globe2 className="h-3.5 w-3.5 text-zinc-400" />
                    {t('setup.presetLabel')}
                  </Label>
                  <Select
                    value={networkPreset}
                    onChange={(e) => setNetworkPreset(e.target.value as any)}
                  >
                    <option value="direct">{t('setup.presetDirect')}</option>
                    <option value="cn-aliyun">{t('setup.presetCn')}</option>
                    <option value="custom">{t('setup.presetCustom')}</option>
                  </Select>
                </div>
              </div>

              {networkPreset === 'custom' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('infra.dockerMirrorLabel')}</Label>
                    <Input
                      placeholder="docker.io"
                      value={customDockerMirror}
                      onChange={(e) => setCustomDockerMirror(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('infra.aptMirrorLabel')}</Label>
                    <Input
                      value={customAptMirror}
                      onChange={(e) => setCustomAptMirror(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('infra.pipIndexLabel')}</Label>
                    <Input
                      value={customPipIndex}
                      onChange={(e) => setCustomPipIndex(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('infra.npmRegistryLabel')}</Label>
                    <Input
                      value={customNpmRegistry}
                      onChange={(e) => setCustomNpmRegistry(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowLocalUsers}
                  onChange={(e) => setAllowLocalUsers(e.target.checked)}
                  className="rounded border-zinc-700 accent-indigo-500"
                />
                <span>{t('setup.allowLocalUsers')}</span>
              </label>

              <Button type="submit" className="w-full" disabled={submitting1}>
                {submitting1 ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                {t('setup.submitStep1')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.step2Title')}</CardTitle>
            <CardDescription>
              {statusData?.base_image_present
                ? t('setup.step2Ready', { image: baseImageFull })
                : t('setup.step2Missing', { image: baseImageFull })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={installBrowser}
                onChange={(e) => setInstallBrowser(e.target.checked)}
                className="rounded border-zinc-700 accent-indigo-500"
              />
              <span>{t('setup.installBrowserLabel')}</span>
            </label>

            <div className="flex flex-wrap gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={startingImgJob}
                onClick={() => startStep2Job('pull')}
              >
                <Download className="h-4 w-4" />
                {t('setup.pullBaseBtn')}
              </Button>
              {statusData?.sandbox_src_available && (
                <Button
                  type="button"
                  disabled={startingImgJob}
                  onClick={() => startStep2Job('base')}
                >
                  <Hammer className="h-4 w-4" />
                  {t('setup.buildBaseBtn')}
                </Button>
              )}
              <Button
                type="button"
                variant={statusData?.base_image_present ? 'default' : 'ghost'}
                onClick={() => advanceOnboarding('llm')}
              >
                {statusData?.base_image_present ? t('setup.nextStep') : t('setup.skipStep2')}
              </Button>
            </div>

            {activeJob && (
              <div className="rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-200">{activeJob.job_key}</span>
                  <Badge
                    variant={
                      activeJob.status === 'succeeded'
                        ? 'success'
                        : activeJob.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {activeJob.status} · {activeJob.progress_stage}
                  </Badge>
                </div>
                <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-[11px] font-mono text-zinc-400">
                  {activeJob.log_text || '...'}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.step3Title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSaveAndTestLlm} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('setup.llmNameLabel')}</Label>
                  <Input
                    required
                    value={llmName}
                    onChange={(e) => setLlmName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.llmProviderLabel')}</Label>
                  <Select
                    value={llmProtocol}
                    onChange={(e) => setLlmProtocol(e.target.value)}
                  >
                    <option value="openai-completions">OpenAI / SGLang / vLLM (Completions)</option>
                    <option value="openai-responses">OpenAI Responses API</option>
                    <option value="anthropic-messages">Anthropic Claude Messages</option>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('setup.llmBaseUrlLabel')}</Label>
                  <Input
                    required
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.llmApiKeyLabel')}</Label>
                  <Input
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('setup.llmModelLabel')}</Label>
                  <Input
                    required
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                  />
                </div>
              </div>

              {llmTestResult && (
                <div
                  className={cn(
                    'rounded-[var(--brand-radius-md)] border p-3 text-xs',
                    llmTestResult.ok
                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/40 text-rose-200',
                  )}
                >
                  {llmTestResult.ok ? t('setup.testOk') : t('setup.testFail', { detail: llmTestResult.detail })}
                </div>
              )}

              <div className="flex flex-wrap gap-2.5 pt-1">
                <Button type="submit" disabled={savingLlm}>
                  {savingLlm ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  {t('setup.testAndSaveLlmBtn')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => advanceOnboarding('done')}
                >
                  {t('setup.finishBtn')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
