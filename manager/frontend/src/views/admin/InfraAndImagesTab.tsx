import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Container,
  Download,
  Hammer,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  Upload,
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
  cn,
} from '../../components/ui'
import { apiFetch } from '../../lib/client.ts'
import { useI18n } from '../../lib/i18nContext'
import type {
  ContainerRegistryItem,
  ContainerRegistryTestResult,
  ImageBuildJobItem,
  ImagePruneResult,
  LocalImageItem,
  PlatformRuntimeSettings,
  TemplateItem,
} from '../../types'

export function InfraAndImagesTab({
  templates,
  localImages,
  onRefreshAll,
  notify,
}: {
  templates: TemplateItem[]
  localImages: LocalImageItem[]
  onRefreshAll: () => Promise<void>
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useI18n()

  // Runtime defaults state
  const [runtimeCfg, setRuntimeCfg] = useState<PlatformRuntimeSettings | null>(null)
  const [savingRuntime, setSavingRuntime] = useState(false)

  // Registries state
  const [registries, setRegistries] = useState<ContainerRegistryItem[]>([])
  const [regModalOpen, setRegModalOpen] = useState(false)
  const [editingReg, setEditingReg] = useState<ContainerRegistryItem | null>(null)
  const [regForm, setRegForm] = useState({
    name: '',
    registry_host: '',
    username: '',
    password: '',
    tls_verify: true,
    is_default: false,
  })
  const [savingReg, setSavingReg] = useState(false)
  const [testingRegId, setTestingRegId] = useState<string | null>(null)

  // Image Factory state
  const [images, setImages] = useState<LocalImageItem[]>(localImages)
  const [jobs, setJobs] = useState<ImageBuildJobItem[]>([])
  const [selectedJob, setSelectedJob] = useState<ImageBuildJobItem | null>(null)
  const [factoryMode, setFactoryMode] = useState<'variant' | 'base' | 'pull' | 'push'>('variant')
  const [submittingJob, setSubmittingJob] = useState(false)
  const [pruning, setPruning] = useState(false)

  // Variant form
  const [variantForm, setVariantForm] = useState({
    image_repo: 'dsh-sandbox',
    image_tag: 'data-analyst',
    base_image: 'dsh-sandbox:latest',
    apt_packages: '',
    pip_packages: 'pandas numpy openpyxl',
    npm_packages: '',
    install_ca_bundle: true,
    push_registry_id: '',
    bind_template_key: '',
  })

  // Base build / Pull / Push forms
  const [baseForm, setBaseForm] = useState({
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    install_browser: false,
    push_registry_id: '',
  })
  const [pullForm, setPullForm] = useState({
    image_repo: 'dsh-sandbox',
    image_tag: 'latest',
    registry_id: '',
  })
  const [pushForm, setPushForm] = useState({
    source_image: localImages[0]?.full_name || 'dsh-sandbox:latest',
    target_repo: '',
    target_tag: 'latest',
    registry_id: '',
  })

  const loadInfra = useCallback(async () => {
    try {
      const [rt, regs, imgRes, jobList] = await Promise.all([
        apiFetch<PlatformRuntimeSettings>('/api/system/runtime-settings'),
        apiFetch<ContainerRegistryItem[]>('/api/registries'),
        apiFetch<{ images: LocalImageItem[] }>('/api/images'),
        apiFetch<ImageBuildJobItem[]>('/api/images/jobs?limit=25'),
      ])
      setRuntimeCfg(rt)
      setRegistries(regs)
      setImages(imgRes.images || [])
      setJobs(jobList)
      setSelectedJob((prev) => {
        if (prev) {
          return jobList.find((j) => j.id === prev.id) || jobList[0] || null
        }
        return jobList[0] || null
      })
    } catch (err: any) {
      notify(err.message || 'Failed to load infrastructure state', 'error')
    }
  }, [notify])

  useEffect(() => {
    void loadInfra()
  }, [loadInfra])

  // Poll live job state whenever there is any active pending/running job
  useEffect(() => {
    const hasActive = jobs.some((j) => ['pending', 'running'].includes(j.status))
    if (!hasActive) return
    const timer = window.setInterval(async () => {
      try {
        const latestJobs = await apiFetch<ImageBuildJobItem[]>('/api/images/jobs?limit=25')
        setJobs(latestJobs)
        setSelectedJob((prev) => {
          if (!prev) return latestJobs[0] || null
          return latestJobs.find((j) => j.id === prev.id) || latestJobs[0] || null
        })
        if (!latestJobs.some((j) => ['pending', 'running'].includes(j.status))) {
          const imgRes = await apiFetch<{ images: LocalImageItem[] }>('/api/images')
          setImages(imgRes.images || [])
          await onRefreshAll()
        }
      } catch {
        // silent poll
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [jobs, onRefreshAll])

  const handleSaveRuntime = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!runtimeCfg) return
    setSavingRuntime(true)
    try {
      const updated = await apiFetch<PlatformRuntimeSettings>('/api/system/runtime-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          network_preset: runtimeCfg.network_preset,
          apply_preset_mirrors: runtimeCfg.network_preset === 'custom' ? false : true,
          docker_registry_mirror: runtimeCfg.docker_registry_mirror,
          apt_mirror: runtimeCfg.apt_mirror,
          node_mirror: runtimeCfg.node_mirror,
          npm_registry: runtimeCfg.npm_registry,
          pip_index_url: runtimeCfg.pip_index_url,
          default_image_repo: runtimeCfg.default_image_repo,
          default_image_tag: runtimeCfg.default_image_tag,
          pull_missing_image: runtimeCfg.pull_missing_image,
          default_cpus: Number(runtimeCfg.default_cpus),
          default_memory: runtimeCfg.default_memory,
          default_timezone: runtimeCfg.default_timezone,
          default_auto_install_plugins: runtimeCfg.default_auto_install_plugins,
        }),
      })
      setRuntimeCfg(updated)
      await onRefreshAll()
      notify(t('infra.runtimeSaved'))
    } catch (err: any) {
      notify(err.message || 'Save failed', 'error')
    } finally {
      setSavingRuntime(false)
    }
  }

  const applyPresetSelection = (preset: 'direct' | 'cn-aliyun' | 'custom') => {
    if (!runtimeCfg) return
    if (preset === 'direct') {
      setRuntimeCfg({
        ...runtimeCfg,
        network_preset: preset,
        apt_mirror: 'deb.debian.org',
        node_mirror: 'https://nodejs.org/dist',
        npm_registry: '',
        pip_index_url: 'https://pypi.org/simple/',
      })
    } else if (preset === 'cn-aliyun') {
      setRuntimeCfg({
        ...runtimeCfg,
        network_preset: preset,
        apt_mirror: 'https://mirrors.aliyun.com',
        node_mirror: 'https://npmmirror.com/mirrors/node',
        npm_registry: 'https://registry.npmmirror.com',
        pip_index_url: 'https://mirrors.aliyun.com/pypi/simple/',
      })
    } else {
      setRuntimeCfg({ ...runtimeCfg, network_preset: preset })
    }
  }

  const openRegModal = (reg: ContainerRegistryItem | null) => {
    setEditingReg(reg)
    setRegForm(
      reg
        ? {
            name: reg.name,
            registry_host: reg.registry_host,
            username: reg.username,
            password: '',
            tls_verify: reg.tls_verify,
            is_default: reg.is_default,
          }
        : {
            name: '',
            registry_host: '',
            username: '',
            password: '',
            tls_verify: true,
            is_default: false,
          },
    )
    setRegModalOpen(true)
  }

  const handleSaveRegistry = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingReg(true)
    try {
      if (editingReg) {
        const body: Record<string, any> = {
          name: regForm.name.trim(),
          registry_host: regForm.registry_host.trim(),
          username: regForm.username.trim(),
          tls_verify: regForm.tls_verify,
          is_default: regForm.is_default,
        }
        if (regForm.password.trim()) {
          body.password = regForm.password
        }
        await apiFetch(`/api/registries/${encodeURIComponent(editingReg.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/registries', {
          method: 'POST',
          body: JSON.stringify(regForm),
        })
      }
      setRegModalOpen(false)
      await loadInfra()
      notify(t('infra.regSaved'))
    } catch (err: any) {
      notify(err.message || 'Save registry failed', 'error')
    } finally {
      setSavingReg(false)
    }
  }

  const handleTestRegistry = async (id: string) => {
    setTestingRegId(id)
    try {
      const res = await apiFetch<ContainerRegistryTestResult>('/api/registries/test', {
        method: 'POST',
        body: JSON.stringify({ registry_id: id }),
      })
      await loadInfra()
      if (res.ok) {
        notify(t('infra.regTestedOk', { detail: res.detail }))
      } else {
        notify(res.detail || 'Registry login failed', 'error')
      }
    } catch (err: any) {
      notify(err.message || 'Test failed', 'error')
    } finally {
      setTestingRegId(null)
    }
  }

  const handleDeleteRegistry = async (id: string) => {
    try {
      await apiFetch(`/api/registries/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadInfra()
      notify(t('infra.regDeleted'))
    } catch (err: any) {
      notify(err.message || 'Delete failed', 'error')
    }
  }

  const splitPkgList = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

  const handleSubmitFactoryJob = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingJob(true)
    try {
      let job: ImageBuildJobItem
      if (factoryMode === 'variant') {
        job = await apiFetch<ImageBuildJobItem>('/api/images/build-variant', {
          method: 'POST',
          body: JSON.stringify({
            image_repo: variantForm.image_repo.trim(),
            image_tag: variantForm.image_tag.trim(),
            base_image: variantForm.base_image.trim(),
            apt_packages: splitPkgList(variantForm.apt_packages),
            pip_packages: splitPkgList(variantForm.pip_packages),
            npm_packages: splitPkgList(variantForm.npm_packages),
            install_ca_bundle: variantForm.install_ca_bundle,
            push_registry_id: variantForm.push_registry_id || null,
            bind_template_key: variantForm.bind_template_key || null,
          }),
        })
      } else if (factoryMode === 'base') {
        job = await apiFetch<ImageBuildJobItem>('/api/images/build-base', {
          method: 'POST',
          body: JSON.stringify({
            image_repo: baseForm.image_repo.trim(),
            image_tag: baseForm.image_tag.trim(),
            install_browser: baseForm.install_browser,
            push_registry_id: baseForm.push_registry_id || null,
          }),
        })
      } else if (factoryMode === 'pull') {
        job = await apiFetch<ImageBuildJobItem>('/api/images/pull', {
          method: 'POST',
          body: JSON.stringify({
            image_repo: pullForm.image_repo.trim(),
            image_tag: pullForm.image_tag.trim(),
            registry_id: pullForm.registry_id || null,
          }),
        })
      } else {
        job = await apiFetch<ImageBuildJobItem>('/api/images/push', {
          method: 'POST',
          body: JSON.stringify({
            source_image: pushForm.source_image.trim(),
            target_repo: pushForm.target_repo.trim(),
            target_tag: pushForm.target_tag.trim(),
            registry_id: pushForm.registry_id || null,
          }),
        })
      }
      setSelectedJob(job)
      await loadInfra()
      notify(t('infra.jobSubmitted', { job: job.job_key }))
    } catch (err: any) {
      notify(err.message || 'Image job failed', 'error')
    } finally {
      setSubmittingJob(false)
    }
  }

  const handlePruneImages = async () => {
    setPruning(true)
    try {
      const res = await apiFetch<ImagePruneResult>('/api/images/prune', { method: 'POST' })
      await loadInfra()
      await onRefreshAll()
      const mb = Math.round((res.reclaimed_bytes / (1024 * 1024)) * 10) / 10
      notify(t('infra.prunedMsg', { mb: String(mb) }))
    } catch (err: any) {
      notify(err.message || 'Prune failed', 'error')
    } finally {
      setPruning(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Hot-reload Platform Runtime Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-indigo-400" />
            {t('infra.runtimeTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runtimeCfg ? (
            <form onSubmit={handleSaveRuntime} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('setup.presetLabel')}</Label>
                  <Select
                    value={runtimeCfg.network_preset}
                    onChange={(e) => applyPresetSelection(e.target.value as any)}
                  >
                    <option value="direct">{t('setup.presetDirect')}</option>
                    <option value="cn-aliyun">{t('setup.presetCn')}</option>
                    <option value="custom">{t('setup.presetCustom')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultRepoLabel')}</Label>
                  <Input
                    value={runtimeCfg.default_image_repo}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, default_image_repo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultTagLabel')}</Label>
                  <Input
                    value={runtimeCfg.default_image_tag}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, default_image_tag: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.dockerMirrorLabel')}</Label>
                  <Input
                    placeholder="docker.io (or mirror host)"
                    value={runtimeCfg.docker_registry_mirror}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, docker_registry_mirror: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.aptMirrorLabel')}</Label>
                  <Input
                    value={runtimeCfg.apt_mirror}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, apt_mirror: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.pipIndexLabel')}</Label>
                  <Input
                    value={runtimeCfg.pip_index_url}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, pip_index_url: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.nodeMirrorLabel')}</Label>
                  <Input
                    value={runtimeCfg.node_mirror}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, node_mirror: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.npmRegistryLabel')}</Label>
                  <Input
                    value={runtimeCfg.npm_registry}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, npm_registry: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultTzLabel')}</Label>
                  <Input
                    value={runtimeCfg.default_timezone}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, default_timezone: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultCpuLabel')}</Label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="64"
                    value={runtimeCfg.default_cpus}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, default_cpus: Number(e.target.value) || 2 })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultMemLabel')}</Label>
                  <Input
                    value={runtimeCfg.default_memory}
                    onChange={(e) =>
                      setRuntimeCfg({ ...runtimeCfg, default_memory: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultPluginsLabel')}</Label>
                  <Input
                    value={runtimeCfg.default_auto_install_plugins}
                    onChange={(e) =>
                      setRuntimeCfg({
                        ...runtimeCfg,
                        default_auto_install_plugins: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={runtimeCfg.pull_missing_image}
                  onChange={(e) =>
                    setRuntimeCfg({ ...runtimeCfg, pull_missing_image: e.target.checked })
                  }
                  className="rounded border-zinc-700 accent-indigo-500"
                />
                <span>{t('infra.pullMissingLabel')}</span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" disabled={savingRuntime} size="sm">
                  <Save className="h-4 w-4" />
                  {t('infra.saveRuntimeBtn')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-xs text-zinc-500 flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading runtime config...
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Encrypted Container Registries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            {t('infra.regTitle')}
          </CardTitle>
          <Button size="sm" onClick={() => openRegModal(null)}>
            <Plus className="h-4 w-4" />
            {t('infra.addRegBtn')}
          </Button>
        </CardHeader>
        <CardContent>
          {registries.length === 0 ? (
            <p className="text-xs text-zinc-400 rounded-[var(--brand-radius-md)] border border-dashed border-zinc-800 p-4">
              {t('infra.regEmpty')}
            </p>
          ) : (
            <div className="space-y-2">
              {registries.map((reg) => (
                <div
                  key={reg.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-zinc-100">{reg.name}</span>
                      <code className="text-xs text-indigo-300 bg-zinc-900 px-1.5 py-0.5 rounded">
                        {reg.registry_host}
                      </code>
                      {reg.is_default && <Badge variant="default">{t('infra.regDefaultBadge')}</Badge>}
                      {reg.last_test_ok === true && (
                        <Badge variant="success">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t('infra.regOkBadge')}
                        </Badge>
                      )}
                      {reg.last_test_ok === false && <Badge variant="destructive">{t('infra.regErrBadge')}</Badge>}
                    </div>
                    <div className="text-xs text-zinc-400">
                      <span className="font-mono text-zinc-300">{reg.username}</span> ·{' '}
                      {reg.tls_verify ? 'HTTPS' : t('infra.regHttpLabel')}
                      {reg.last_error ? ` · ${reg.last_error}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testingRegId === reg.id}
                      onClick={() => handleTestRegistry(reg.id)}
                    >
                      <RefreshCw
                        className={cn('h-3.5 w-3.5', testingRegId === reg.id && 'animate-spin')}
                      />
                      {t('infra.regTestBtn')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openRegModal(reg)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteRegistry(reg.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Digital Employee Image Factory */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Container className="h-4 w-4 text-sky-400" />
            {t('infra.factoryTitle')}
          </CardTitle>
          <Button size="sm" variant="outline" disabled={pruning} onClick={handlePruneImages}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('infra.pruneBtn')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Local images summary pills */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-zinc-400">
              {t('infra.localImagesTitle', { count: images.length })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {images.map((img) => (
                <Badge key={img.full_name} variant="outline" className="font-mono text-[11px]">
                  {img.full_name} ({img.size_mb} MB)
                </Badge>
              ))}
            </div>
          </div>

          {/* Factory action selector */}
          <div className="inline-flex flex-wrap gap-1 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950 p-1">
            {(
              [
                ['variant', t('infra.modeVariant')],
                ['base', t('infra.modeBase')],
                ['pull', t('infra.modePull')],
                ['push', t('infra.modePush')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFactoryMode(k)}
                className={cn(
                  'rounded-[var(--brand-radius-sm)] px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors',
                  factoryMode === k
                    ? 'brand-tab-active'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmitFactoryJob} className="space-y-3 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/50 p-4">
            {factoryMode === 'variant' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setVariantForm({
                        ...variantForm,
                        image_tag: 'data-analyst',
                        apt_packages: '',
                        pip_packages: 'pandas numpy openpyxl matplotlib',
                        npm_packages: '',
                      })
                    }
                  >
                    {t('infra.presetVariantData')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setVariantForm({
                        ...variantForm,
                        image_tag: 'devops-sre',
                        apt_packages: 'jq dnsutils curl',
                        pip_packages: 'ansible-core',
                        npm_packages: '',
                      })
                    }
                  >
                    {t('infra.presetVariantDevops')}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('infra.baseImageLabel')}</Label>
                    <Input
                      required
                      value={variantForm.base_image}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, base_image: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('infra.defaultRepoLabel')}</Label>
                    <Input
                      required
                      value={variantForm.image_repo}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, image_repo: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('infra.variantTagLabel')}</Label>
                    <Input
                      required
                      value={variantForm.image_tag}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, image_tag: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('infra.aptPkgsLabel')}</Label>
                    <Input
                      placeholder="jq, poppler-utils"
                      value={variantForm.apt_packages}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, apt_packages: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('infra.pipPkgsLabel')}</Label>
                    <Input
                      placeholder="pandas openpyxl"
                      value={variantForm.pip_packages}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, pip_packages: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('infra.npmPkgsLabel')}</Label>
                    <Input
                      placeholder="tsx typescript"
                      value={variantForm.npm_packages}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, npm_packages: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('infra.pushTargetLabel')}</Label>
                    <Select
                      value={variantForm.push_registry_id}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, push_registry_id: e.target.value })
                      }
                    >
                      <option value="">{t('infra.noPushOption')}</option>
                      {registries.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.registry_host})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('infra.bindTemplateLabel')}</Label>
                    <Select
                      value={variantForm.bind_template_key}
                      onChange={(e) =>
                        setVariantForm({ ...variantForm, bind_template_key: e.target.value })
                      }
                    >
                      <option value="">{t('infra.noBindOption')}</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.key}>
                          {tpl.name} ({tpl.key})
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </>
            )}

            {factoryMode === 'base' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultRepoLabel')}</Label>
                  <Input
                    required
                    value={baseForm.image_repo}
                    onChange={(e) => setBaseForm({ ...baseForm, image_repo: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultTagLabel')}</Label>
                  <Input
                    required
                    value={baseForm.image_tag}
                    onChange={(e) => setBaseForm({ ...baseForm, image_tag: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.pushTargetLabel')}</Label>
                  <Select
                    value={baseForm.push_registry_id}
                    onChange={(e) =>
                      setBaseForm({ ...baseForm, push_registry_id: e.target.value })
                    }
                  >
                    <option value="">{t('infra.noPushOption')}</option>
                    {registries.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.registry_host})
                      </option>
                    ))}
                  </Select>
                </div>
                <label className="sm:col-span-3 flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={baseForm.install_browser}
                    onChange={(e) =>
                      setBaseForm({ ...baseForm, install_browser: e.target.checked })
                    }
                    className="rounded border-zinc-700 accent-indigo-500"
                  />
                  <span>{t('setup.installBrowserLabel')}</span>
                </label>
              </div>
            )}

            {factoryMode === 'pull' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultRepoLabel')}</Label>
                  <Input
                    required
                    value={pullForm.image_repo}
                    onChange={(e) => setPullForm({ ...pullForm, image_repo: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.defaultTagLabel')}</Label>
                  <Input
                    required
                    value={pullForm.image_tag}
                    onChange={(e) => setPullForm({ ...pullForm, image_tag: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.registryOptLabel')}</Label>
                  <Select
                    value={pullForm.registry_id}
                    onChange={(e) => setPullForm({ ...pullForm, registry_id: e.target.value })}
                  >
                    <option value="">{t('infra.autoMatchHost')}</option>
                    {registries.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.registry_host})
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            {factoryMode === 'push' && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('infra.sourceImageLabel')}</Label>
                  <Input
                    required
                    value={pushForm.source_image}
                    onChange={(e) =>
                      setPushForm({ ...pushForm, source_image: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.targetRepoLabel')}</Label>
                  <Input
                    required
                    placeholder="registry.example.com/org/dsh-sandbox"
                    value={pushForm.target_repo}
                    onChange={(e) =>
                      setPushForm({ ...pushForm, target_repo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.targetTagLabel')}</Label>
                  <Input
                    required
                    value={pushForm.target_tag}
                    onChange={(e) =>
                      setPushForm({ ...pushForm, target_tag: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('infra.registryLabel')}</Label>
                  <Select
                    value={pushForm.registry_id}
                    onChange={(e) => setPushForm({ ...pushForm, registry_id: e.target.value })}
                  >
                    <option value="">{t('infra.autoMatchHost')}</option>
                    {registries.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.registry_host})
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={submittingJob}>
                {factoryMode === 'pull' ? (
                  <Download className="h-4 w-4" />
                ) : factoryMode === 'push' ? (
                  <Upload className="h-4 w-4" />
                ) : (
                  <Hammer className="h-4 w-4" />
                )}
                {t('infra.startJobBtn')}
              </Button>
            </div>
          </form>

          {/* Build jobs + Live log stream */}
          {(jobs.length > 0 || selectedJob) && (
            <div className={cn('grid grid-cols-1 gap-4', selectedJob && 'lg:grid-cols-2')}>
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">{t('infra.jobsHistoryTitle')}</div>
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJob(job)}
                      className={cn(
                        'w-full text-left rounded-[var(--brand-radius-sm)] border px-3 py-2 text-xs transition-colors cursor-pointer',
                        selectedJob?.id === job.id
                          ? 'border-indigo-500/60 bg-indigo-950/30'
                          : 'border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900/70',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-zinc-200 truncate">{job.job_key}</span>
                        <Badge
                          variant={
                            job.status === 'succeeded'
                              ? 'success'
                              : job.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center justify-between">
                        <span>
                          {job.kind} · {job.progress_stage}
                        </span>
                        {job.size_bytes ? (
                          <span>{Math.round(job.size_bytes / (1024 * 1024))} MB</span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {selectedJob && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-zinc-400">
                    {t('infra.jobLogTitle', { job: selectedJob.job_key })}
                  </div>
                  <pre className="h-72 overflow-y-auto whitespace-pre-wrap rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950 p-3 text-[11px] font-mono text-zinc-300">
                    {selectedJob.log_text || '—'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Container Registry Dialog */}
      <Dialog
        open={regModalOpen}
        onOpenChange={setRegModalOpen}
        title={editingReg ? editingReg.name : t('infra.addRegBtn')}
      >
        <form onSubmit={handleSaveRegistry} className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('infra.regNameLabel')}</Label>
            <Input
              required
              placeholder="Private Harbor / Aliyun ACR / GHCR"
              value={regForm.name}
              onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('infra.regHostLabel')}</Label>
            <Input
              required
              placeholder="ghcr.io / registry.cn-hangzhou.aliyuncs.com / 127.0.0.1:5000"
              value={regForm.registry_host}
              onChange={(e) => setRegForm({ ...regForm, registry_host: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('infra.regUserLabel')}</Label>
            <Input
              required
              value={regForm.username}
              onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {t('infra.regPassLabel')}{' '}
              {editingReg ? (
                <span className="text-zinc-500 text-xs">{t('infra.regPassKeepHint')}</span>
              ) : (
                '*'
              )}
            </Label>
            <Input
              type="password"
              required={!editingReg}
              value={regForm.password}
              onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={regForm.tls_verify}
              onChange={(e) => setRegForm({ ...regForm, tls_verify: e.target.checked })}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            <span>{t('infra.regTlsLabel')}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={regForm.is_default}
              onChange={(e) => setRegForm({ ...regForm, is_default: e.target.checked })}
              className="rounded border-zinc-700 accent-indigo-500"
            />
            <span>{t('infra.regDefaultLabel')}</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRegModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingReg}>
              {savingReg ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
