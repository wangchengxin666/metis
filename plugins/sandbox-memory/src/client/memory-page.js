import { MEMORY_CATEGORIES, rankMemories } from '../shared/model.js'
import { createTranslator, resolveLang } from './locale.js'
import {
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  FolderIcon,
  GlobeIcon,
  MemoryNavIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ServerIcon,
  SparkleIcon,
  TerminalIcon,
  TrashIcon,
} from './icons.js'

function categoryLabelKey(cat) {
  switch (cat) {
    case 'preference': return 'catPreference'
    case 'project': return 'catProject'
    case 'environment': return 'catEnvironment'
    case 'workflow': return 'catWorkflow'
    case 'pitfall': return 'catPitfall'
    default: return 'catFact'
  }
}

function sourceLabelKey(src) {
  if (src === 'auto') return 'srcAuto'
  if (src === 'agent') return 'srcAgent'
  return 'srcManual'
}

function formatMemoryTime(ts, lang) {
  if (!ts) return '—'
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000))
  if (diffSec < 60) return lang === 'zh' ? '刚刚' : 'just now'
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60)
    return lang === 'zh' ? `${m} 分钟前` : `${m}m ago`
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600)
    return lang === 'zh' ? `${h} 小时前` : `${h}h ago`
  }
  const d = Math.floor(diffSec / 86400)
  if (d < 30) return lang === 'zh' ? `${d} 天前` : `${d}d ago`
  try {
    return new Date(Number(ts)).toISOString().slice(0, 10)
  } catch {
    return '—'
  }
}

function copyMemoryText(text) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  if (nav?.clipboard?.writeText) {
    return nav.clipboard.writeText(String(text || '')).then(() => true).catch(() => false)
  }
  return Promise.resolve(false)
}

function downloadJsonFile(data, filename) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

function renderToggleSwitch(h, checked, onToggle, disabled = false, label = '') {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked ? 'true' : 'false',
      'aria-label': label,
      className: 'smem-toggle',
      disabled,
      onClick: () => onToggle(!checked),
    },
    h('span', { className: 'smem-toggle-thumb' }),
  )
}

function renderPolicySection({ React, settings, busy, t, onPatchSettings }) {
  const h = React.createElement
  const envSec = settings.envSections || {}
  const envKeys = [
    { key: 'urls', label: t('secUrls') },
    { key: 'toolchains', label: t('secToolchains') },
    { key: 'projects', label: t('secProjects') },
    { key: 'services', label: t('secServices') },
    { key: 'routes', label: t('secRoutes') },
    { key: 'cron', label: t('secCron') },
  ]

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optEnabled')),
        h('div', { className: 'smem-policy-desc' }, t('optEnabledDesc')),
      ),
      renderToggleSwitch(h, Boolean(settings.enabled), (v) => onPatchSettings({ enabled: v }), busy, t('optEnabled')),
    ),
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optAutoCapture')),
        h('div', { className: 'smem-policy-desc' }, t('optAutoCaptureDesc')),
      ),
      renderToggleSwitch(h, Boolean(settings.autoCapture), (v) => onPatchSettings({ autoCapture: v }), busy, t('optAutoCapture')),
    ),
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optAgentAutoWrite')),
        h('div', { className: 'smem-policy-desc' }, t('optAgentAutoWriteDesc')),
      ),
      renderToggleSwitch(h, Boolean(settings.agentAutoWrite), (v) => onPatchSettings({ agentAutoWrite: v }), busy, t('optAgentAutoWrite')),
    ),
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optIncludeEnv')),
        h('div', { className: 'smem-policy-desc' }, t('optIncludeEnvDesc')),
      ),
      renderToggleSwitch(h, Boolean(settings.includeEnvSnapshot), (v) => onPatchSettings({ includeEnvSnapshot: v }), busy, t('optIncludeEnv')),
    ),
    settings.includeEnvSnapshot
      ? h(
          'div',
          { className: 'smem-policy-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
          h('div', { className: 'smem-policy-title' }, t('optEnvSections')),
          h(
            'div',
            { className: 'smem-check-row' },
            ...envKeys.map((item) =>
              h(
                'label',
                { key: item.key, className: 'smem-check-label' },
                h('input', {
                  type: 'checkbox',
                  checked: envSec[item.key] !== false,
                  disabled: busy,
                  onChange: (e) => onPatchSettings({
                    envSections: { [item.key]: Boolean(e.target.checked) },
                  }),
                }),
                item.label,
              ),
            ),
          ),
        )
      : null,
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optMaxItems')),
        h('div', { className: 'smem-policy-desc' }, t('optMaxItemsDesc')),
      ),
      h(
        'select',
        {
          className: 'smem-select',
          value: String(settings.maxIndexItems || 30),
          disabled: busy,
          onChange: (e) => onPatchSettings({ maxIndexItems: Number(e.target.value) }),
        },
        ...[10, 20, 30, 50, 80].map((n) => h('option', { key: n, value: String(n) }, String(n))),
      ),
    ),
    h(
      'div',
      { className: 'smem-policy-row' },
      h(
        'div',
        { className: 'smem-policy-meta' },
        h('div', { className: 'smem-policy-title' }, t('optMaxChars')),
        h('div', { className: 'smem-policy-desc' }, t('optMaxCharsDesc')),
      ),
      h(
        'select',
        {
          className: 'smem-select',
          value: String(settings.maxIndexChars || 2800),
          disabled: busy,
          onChange: (e) => onPatchSettings({ maxIndexChars: Number(e.target.value) }),
        },
        ...[1200, 2000, 2800, 4500, 8000].map((n) =>
          h('option', { key: n, value: String(n) }, `${n} chars`),
        ),
      ),
    ),
  )
}

export function createMemoryMainPage({ React, controller, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function MemoryMainPage() {
    const [, setTick] = React.useState(0)
    const [activeTab, setActiveTab] = React.useState('memories')
    const [searchQuery, setSearchQuery] = React.useState('')
    const [categoryFilter, setCategoryFilter] = React.useState('')
    const [sourceFilter, setSourceFilter] = React.useState('')
    const [expandedIds, setExpandedIds] = React.useState({})
    const [confirmDeleteId, setConfirmDeleteId] = React.useState('')

    // Create / Edit form state
    const [editorMode, setEditorMode] = React.useState('') // '' | 'create' | 'edit'
    const [editingId, setEditingId] = React.useState('')
    const [formTitle, setFormTitle] = React.useState('')
    const [formCategory, setFormCategory] = React.useState('preference')
    const [formSummary, setFormSummary] = React.useState('')
    const [formContent, setFormContent] = React.useState('')
    const [formTags, setFormTags] = React.useState('')
    const [formPinned, setFormPinned] = React.useState(false)
    const [formEnabled, setFormEnabled] = React.useState(true)

    // Import panel state
    const [showImport, setShowImport] = React.useState(false)
    const [importText, setImportText] = React.useState('')
    const [importMode, setImportMode] = React.useState('merge')

    React.useEffect(() => {
      const offCtrl = controller.subscribe(() => setTick((n) => n + 1))
      const offLoc = typeof subscribeLocale === 'function'
        ? subscribeLocale(() => setTick((n) => n + 1))
        : () => {}
      void controller.syncFromHost({ force: true })
      const poll = typeof setInterval === 'function'
        ? setInterval(() => { void controller.syncFromHost() }, 8000)
        : null
      return () => {
        offCtrl()
        offLoc()
        if (poll) clearInterval(poll)
      }
    }, [])

    const localeStr = typeof getLocale === 'function' ? getLocale() : 'en'
    const lang = resolveLang(localeStr)
    const t = createTranslator(localeStr)
    const { state, busy, toast } = controller.getSnapshot()
    const memories = Array.isArray(state.memories) ? state.memories : []
    const settings = state.settings || {}
    const envSnap = state.envSnapshot || {}
    const preview = state.preview || {}
    const budget = preview.budget || {}
    const stats = state.stats || {}

    const indexedIdSet = new Set()
    for (const line of String(preview.indexText || '').split('\n')) {
      const m = line.match(/^- \*?\[([^|\]]+)\|/)
      if (m) indexedIdSet.add(m[1])
    }

    const filteredMemories = rankMemories(memories, searchQuery, {
      category: categoryFilter,
      source: sourceFilter,
      includeDisabled: true,
      limit: 500,
    }).map((r) => r.entry)

    function openCreateForm() {
      setEditorMode('create')
      setEditingId('')
      setFormTitle('')
      setFormCategory(categoryFilter || 'preference')
      setFormSummary('')
      setFormContent('')
      setFormTags('')
      setFormPinned(false)
      setFormEnabled(true)
      setActiveTab('memories')
    }

    function openEditForm(entry) {
      setEditorMode('edit')
      setEditingId(entry.id)
      setFormTitle(entry.title || '')
      setFormCategory(entry.category || 'fact')
      setFormSummary(entry.summary || '')
      setFormContent(entry.content || '')
      setFormTags(Array.isArray(entry.tags) ? entry.tags.join(', ') : '')
      setFormPinned(Boolean(entry.pinned))
      setFormEnabled(entry.enabled !== false)
    }

    async function handleFormSubmit(e) {
      e.preventDefault()
      const payload = {
        title: formTitle.trim(),
        category: formCategory,
        summary: formSummary.trim(),
        content: formContent.trim() || formSummary.trim() || formTitle.trim(),
        tags: formTags,
        pinned: formPinned,
        enabled: formEnabled,
      }
      if (!payload.content && !payload.title) return
      const res = editorMode === 'edit' && editingId
        ? await controller.updateMemory(editingId, payload)
        : await controller.createMemory(payload)
      if (res?.ok) {
        setEditorMode('')
        setEditingId('')
      }
    }

    async function handleExport() {
      const data = await controller.exportMemories()
      if (data) {
        downloadJsonFile(data, `dsh-memories-${new Date().toISOString().slice(0, 10)}.json`)
      }
    }

    async function handleRunImport() {
      try {
        const parsed = JSON.parse(importText)
        const res = await controller.importMemories(parsed, importMode)
        if (res?.ok) {
          setShowImport(false)
          setImportText('')
        }
      } catch (err) {
        controller.showToast('error', 'toastError', err?.message || 'Invalid JSON')
      }
    }

    async function handleCopyIndex() {
      const ok = await copyMemoryText(preview.contextText || preview.indexText || '')
      if (ok) controller.showToast('ok', 'toastCopied')
    }

    const budgetPct = Math.min(100, Math.round(((budget.indexChars || 0) / Math.max(1, budget.maxIndexChars || 2800)) * 100))
    const budgetClass = budgetPct >= 90 ? 'high' : (budgetPct >= 70 ? 'warn' : '')

    return h(
      'div',
      { className: 'smem-page' },
      h(
        'div',
        { className: 'smem-scroll' },
        h(
          'div',
          { className: 'smem-container' },
          // Header
          h(
            'div',
            { className: 'smem-header' },
            h(
              'div',
              { className: 'smem-title-wrap' },
              h('div', { className: 'smem-title-badge' }, h(MemoryNavIcon, { React, size: 20 })),
              h(
                'div',
                { style: { minWidth: 0 } },
                h('h1', { className: 'smem-title' }, t('title')),
                h('p', { className: 'smem-subtitle' }, t('subtitle')),
              ),
            ),
            h(
              'div',
              { className: 'smem-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'smem-btn',
                  disabled: busy,
                  onClick: () => void controller.syncFromHost({ force: true }),
                },
                h(RefreshIcon, { React, size: 13 }),
                t('btnRefresh'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'smem-btn smem-btn-primary',
                  disabled: busy,
                  onClick: openCreateForm,
                },
                h(PlusIcon, { React, size: 14 }),
                t('btnNewMemory'),
              ),
            ),
          ),

          // Toast notification
          toast
            ? h(
                'div',
                { className: `smem-toast${toast.kind === 'error' ? ' error' : ''}` },
                h(
                  'span',
                  null,
                  t(toast.key),
                  toast.detail ? ` — ${toast.detail}` : '',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'smem-btn smem-btn-sm smem-btn-icon',
                    onClick: () => controller.clearToast(),
                  },
                  h(CloseIcon, { React, size: 12 }),
                ),
              )
            : null,

          // Stats + Token Budget Strip
          h(
            'div',
            { className: 'smem-stats-grid' },
            h(
              'div',
              { className: 'smem-stat-card' },
              h('div', { className: 'smem-stat-label' }, t('statActive')),
              h(
                'div',
                { className: 'smem-stat-value' },
                String(stats.enabled ?? 0),
                h('span', { className: 'smem-stat-sub' }, `/ ${stats.total ?? 0}`),
              ),
            ),
            h(
              'div',
              { className: 'smem-stat-card' },
              h('div', { className: 'smem-stat-label' }, t('statAuto')),
              h(
                'div',
                { className: 'smem-stat-value' },
                String((stats.bySource?.auto || 0) + (stats.bySource?.agent || 0)),
                h('span', { className: 'smem-stat-sub' }, `${stats.bySource?.auto || 0} / ${stats.bySource?.agent || 0}`),
              ),
            ),
            h(
              'div',
              { className: 'smem-stat-card' },
              h('div', { className: 'smem-stat-label' }, t('statManual')),
              h('div', { className: 'smem-stat-value' }, String(stats.bySource?.manual || 0)),
            ),
            h(
              'div',
              { className: 'smem-stat-card' },
              h('div', { className: 'smem-stat-label' }, t('statTokens')),
              h(
                'div',
                { className: 'smem-stat-value' },
                `~${budget.totalTokens ?? 0}`,
                h('span', { className: 'smem-stat-sub' }, t('tokenUnit')),
              ),
              h(
                'div',
                { className: 'smem-budget-bar', title: t('tokenBudgetHint') },
                h('div', {
                  className: `smem-budget-fill${budgetClass ? ` ${budgetClass}` : ''}`,
                  style: { width: `${budgetPct}%` },
                }),
              ),
            ),
          ),

          // Tabs
          h(
            'div',
            { className: 'smem-tabs', role: 'tablist' },
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': activeTab === 'memories' ? 'true' : 'false',
                className: `smem-tab${activeTab === 'memories' ? ' active' : ''}`,
                onClick: () => setActiveTab('memories'),
              },
              t('tabMemories'),
              h('span', { className: 'smem-tab-count' }, String(memories.length)),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': activeTab === 'environment' ? 'true' : 'false',
                className: `smem-tab${activeTab === 'environment' ? ' active' : ''}`,
                onClick: () => setActiveTab('environment'),
              },
              t('tabEnvironment'),
              h('span', { className: 'smem-tab-count' }, String((envSnap.projects?.length || 0) + (envSnap.services?.length || 0))),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': activeTab === 'context' ? 'true' : 'false',
                className: `smem-tab${activeTab === 'context' ? ' active' : ''}`,
                onClick: () => setActiveTab('context'),
              },
              t('tabContext'),
            ),
          ),

          // TAB 1: MEMORIES
          activeTab === 'memories'
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
                // Create/Edit Inline Form
                editorMode
                  ? h(
                      'form',
                      { className: 'smem-form-box', onSubmit: handleFormSubmit },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                        h('strong', { style: { fontSize: '14px' } }, editorMode === 'edit' ? t('formEditTitle') : t('formCreateTitle')),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'smem-btn smem-btn-sm smem-btn-icon',
                            onClick: () => setEditorMode(''),
                          },
                          h(CloseIcon, { React, size: 13 }),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'smem-form-grid' },
                        h(
                          'div',
                          { className: 'smem-field' },
                          h('label', null, t('fieldTitle')),
                          h('input', {
                            className: 'smem-input',
                            value: formTitle,
                            placeholder: t('fieldTitlePlaceholder'),
                            onChange: (e) => setFormTitle(e.target.value),
                            required: true,
                          }),
                        ),
                        h(
                          'div',
                          { className: 'smem-field' },
                          h('label', null, t('fieldCategory')),
                          h(
                            'select',
                            {
                              className: 'smem-select',
                              style: { width: '100%' },
                              value: formCategory,
                              onChange: (e) => setFormCategory(e.target.value),
                            },
                            ...MEMORY_CATEGORIES.map((c) => h('option', { key: c, value: c }, t(categoryLabelKey(c)))),
                          ),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'smem-field' },
                        h('label', null, t('fieldSummary')),
                        h('input', {
                          className: 'smem-input',
                          value: formSummary,
                          placeholder: t('fieldSummaryPlaceholder'),
                          onChange: (e) => setFormSummary(e.target.value),
                        }),
                      ),
                      h(
                        'div',
                        { className: 'smem-field' },
                        h('label', null, t('fieldContent')),
                        h('textarea', {
                          className: 'smem-textarea',
                          value: formContent,
                          placeholder: t('fieldContentPlaceholder'),
                          onChange: (e) => setFormContent(e.target.value),
                        }),
                      ),
                      h(
                        'div',
                        { className: 'smem-field' },
                        h('label', null, t('fieldTags')),
                        h('input', {
                          className: 'smem-input',
                          value: formTags,
                          placeholder: t('fieldTagsPlaceholder'),
                          onChange: (e) => setFormTags(e.target.value),
                        }),
                      ),
                      h(
                        'div',
                        { className: 'smem-check-row' },
                        h(
                          'label',
                          { className: 'smem-check-label' },
                          h('input', {
                            type: 'checkbox',
                            checked: formPinned,
                            onChange: (e) => setFormPinned(Boolean(e.target.checked)),
                          }),
                          t('fieldPinned'),
                        ),
                        h(
                          'label',
                          { className: 'smem-check-label' },
                          h('input', {
                            type: 'checkbox',
                            checked: formEnabled,
                            onChange: (e) => setFormEnabled(Boolean(e.target.checked)),
                          }),
                          t('fieldEnabled'),
                        ),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
                        h(
                          'button',
                          { type: 'button', className: 'smem-btn', onClick: () => setEditorMode('') },
                          t('btnCancel'),
                        ),
                        h(
                          'button',
                          { type: 'submit', className: 'smem-btn smem-btn-primary', disabled: busy },
                          h(CheckIcon, { React, size: 13 }),
                          t('btnSave'),
                        ),
                      ),
                    )
                  : null,

                // Search & Filters Toolbar
                h(
                  'div',
                  { className: 'smem-toolbar' },
                  h(
                    'div',
                    { className: 'smem-search-wrap' },
                    h('span', { className: 'smem-search-icon' }, h(SearchIcon, { React, size: 14 })),
                    h('input', {
                      className: 'smem-input with-icon',
                      value: searchQuery,
                      placeholder: t('searchPlaceholder'),
                      onChange: (e) => setSearchQuery(e.target.value),
                    }),
                  ),
                  h(
                    'select',
                    {
                      className: 'smem-select',
                      value: sourceFilter,
                      onChange: (e) => setSourceFilter(e.target.value),
                    },
                    h('option', { value: '' }, t('srcAll')),
                    h('option', { value: 'auto' }, t('srcAuto')),
                    h('option', { value: 'agent' }, t('srcAgent')),
                    h('option', { value: 'manual' }, t('srcManual')),
                  ),
                ),

                // Category Filter Pills
                h(
                  'div',
                  { className: 'smem-pills' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `smem-pill${categoryFilter === '' ? ' active' : ''}`,
                      onClick: () => setCategoryFilter(''),
                    },
                    t('filterAll'),
                  ),
                  ...MEMORY_CATEGORIES.map((cat) =>
                    h(
                      'button',
                      {
                        key: cat,
                        type: 'button',
                        className: `smem-pill${categoryFilter === cat ? ' active' : ''}`,
                        onClick: () => setCategoryFilter(categoryFilter === cat ? '' : cat),
                      },
                      t(categoryLabelKey(cat)),
                      stats.byCategory?.[cat] ? ` (${stats.byCategory[cat]})` : '',
                    ),
                  ),
                ),

                // Memory Cards List
                filteredMemories.length === 0
                  ? h(
                      'div',
                      { className: 'smem-empty' },
                      h(MemoryNavIcon, { React, size: 28 }),
                      h('h3', null, t('emptyMemoriesTitle')),
                      h('p', null, memories.length === 0 ? t('emptyMemoriesDesc') : t('emptySearchDesc')),
                    )
                  : h(
                      'div',
                      { className: 'smem-list' },
                      ...filteredMemories.map((m) => {
                        const isExpanded = Boolean(expandedIds[m.id])
                        const hasLongBody = Boolean(m.content && m.content.trim() !== m.summary?.trim())
                        const inIndex = indexedIdSet.has(m.id)
                        return h(
                          'div',
                          {
                            key: m.id,
                            className: `smem-card${m.enabled === false ? ' disabled' : ''}${m.pinned ? ' pinned' : ''}`,
                          },
                          h(
                            'div',
                            { className: 'smem-card-head' },
                            h(
                              'div',
                              { className: 'smem-card-title-row' },
                              h('span', { className: `smem-badge cat-${m.category}` }, t(categoryLabelKey(m.category))),
                              h('span', { className: `smem-badge src-${m.source}` },
                                m.source !== 'manual' ? h(SparkleIcon, { React, size: 11 }) : null,
                                t(sourceLabelKey(m.source)),
                              ),
                              m.pinned ? h('span', { className: 'smem-badge pin' }, h(PinIcon, { React, size: 11, filled: true }), t('badgePinned')) : null,
                              m.enabled === false
                                ? h('span', { className: 'smem-badge' }, t('badgeDisabled'))
                                : h('span', { className: 'smem-badge' }, inIndex ? t('badgeInIndex') : t('badgeSearchOnly')),
                              h('span', { className: 'smem-card-title' }, m.title),
                            ),
                            h(
                              'div',
                              { className: 'smem-card-ops' },
                              renderToggleSwitch(
                                h,
                                m.enabled !== false,
                                (nextVal) => void controller.updateMemory(m.id, { enabled: nextVal }),
                                busy,
                                m.title,
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'smem-btn smem-btn-sm smem-btn-icon',
                                  title: m.pinned ? t('btnUnpin') : t('btnPin'),
                                  disabled: busy,
                                  onClick: () => void controller.updateMemory(m.id, { pinned: !m.pinned }),
                                },
                                h(PinIcon, { React, size: 13, filled: Boolean(m.pinned) }),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'smem-btn smem-btn-sm smem-btn-icon',
                                  title: t('btnEdit'),
                                  disabled: busy,
                                  onClick: () => openEditForm(m),
                                },
                                h(EditIcon, { React, size: 13 }),
                              ),
                              confirmDeleteId === m.id
                                ? h(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'smem-btn smem-btn-sm smem-btn-danger',
                                      disabled: busy,
                                      onClick: async () => {
                                        await controller.deleteMemory(m.id)
                                        setConfirmDeleteId('')
                                      },
                                    },
                                    t('btnConfirmDelete'),
                                  )
                                : h(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'smem-btn smem-btn-sm smem-btn-icon smem-btn-danger',
                                      title: t('btnDelete'),
                                      disabled: busy,
                                      onClick: () => setConfirmDeleteId(m.id),
                                    },
                                    h(TrashIcon, { React, size: 13 }),
                                  ),
                            ),
                          ),
                          h('p', { className: 'smem-card-summary' }, m.summary),
                          hasLongBody && isExpanded
                            ? h('pre', { className: 'smem-card-content' }, m.content)
                            : null,
                          h(
                            'div',
                            { className: 'smem-card-foot' },
                            h(
                              'div',
                              { className: 'smem-tags' },
                              h('span', { className: 'smem-tag', style: { fontFamily: 'monospace' } }, m.id),
                              ...(m.tags || []).map((tag) => h('span', { key: tag, className: 'smem-tag' }, `#${tag}`)),
                            ),
                            h(
                              'div',
                              { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } },
                              h('span', null, `${t('metaAccessed')}: ${m.accessCount || 0}`),
                              h('span', null, `${t('metaUpdated')}: ${formatMemoryTime(m.updatedAt, lang)}`),
                              hasLongBody
                                ? h(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'smem-btn smem-btn-sm',
                                      onClick: () => setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] })),
                                    },
                                    h(ChevronIcon, { React, size: 12, expanded: isExpanded }),
                                    isExpanded ? t('btnCollapse') : t('btnExpand'),
                                  )
                                : null,
                            ),
                          ),
                        )
                      }),
                    ),
              )
            : null,

          // TAB 2: ENVIRONMENT SNAPSHOT
          activeTab === 'environment'
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
                h(
                  'div',
                  { className: 'smem-header', style: { alignItems: 'center' } },
                  h(
                    'div',
                    null,
                    h('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, t('envTitle')),
                    h('p', { className: 'smem-subtitle' }, t('envSubtitle')),
                  ),
                  h(
                    'div',
                    { className: 'smem-actions' },
                    h('span', { className: 'smem-stat-sub' }, `${t('envLastScanned')}: ${formatMemoryTime(envSnap.scannedAt, lang)}`),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'smem-btn smem-btn-primary',
                        disabled: busy,
                        onClick: () => void controller.refreshEnvironment(true),
                      },
                      h(RefreshIcon, { React, size: 13 }),
                      t('btnRefreshEnv'),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'smem-env-grid' },
                  // Card 1: Sandbox Info
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(GlobeIcon, { React, size: 14 }), t('envCardSandbox')),
                    ),
                    h(
                      'div',
                      { className: 'smem-kv-list' },
                      h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelSlug')), h('span', { className: 'smem-kv-val' }, envSnap.info?.slug || '—')),
                      h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelHome')), h('span', { className: 'smem-kv-val' }, envSnap.info?.homeDir || '/home/workspace')),
                      h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelPublicUrl')), h('span', { className: 'smem-kv-val' }, envSnap.info?.publicUrl || '—')),
                      h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelAppsBase')), h('span', { className: 'smem-kv-val' }, envSnap.info?.appsBaseUrl || '—')),
                      h('div', { className: 'smem-kv-row' }, h('span', { className: 'smem-kv-key' }, t('envLabelPortsBase')), h('span', { className: 'smem-kv-val' }, envSnap.info?.portProxyBaseUrl || '—')),
                    ),
                  ),

                  // Card 2: Toolchains
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(TerminalIcon, { React, size: 14 }), t('envCardToolchains')),
                      h('span', { className: 'smem-tab-count' }, String(envSnap.toolchains?.length || 0)),
                    ),
                    envSnap.toolchains?.length
                      ? h(
                          'div',
                          { className: 'smem-chip-wrap' },
                          ...envSnap.toolchains.map((tc) =>
                            h('span', { key: tc.name, className: 'smem-chip' }, tc.version && tc.version !== 'installed' ? `${tc.name}@${tc.version}` : tc.name),
                          ),
                        )
                      : h('span', { className: 'smem-subtitle' }, t('envEmptyNone')),
                  ),

                  // Card 3: Projects
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(FolderIcon, { React, size: 14 }), t('envCardProjects')),
                      h('span', { className: 'smem-tab-count' }, String(envSnap.projects?.length || 0)),
                    ),
                    envSnap.projects?.length
                      ? h(
                          'div',
                          { className: 'smem-kv-list' },
                          ...envSnap.projects.map((p) =>
                            h(
                              'div',
                              { key: p.name, className: 'smem-kv-row' },
                              h('span', { className: 'smem-kv-val', style: { textAlign: 'left', fontWeight: 600 } }, p.name),
                              h(
                                'div',
                                { className: 'smem-tags' },
                                ...(p.stacks || []).map((st) => h('span', { key: st, className: 'smem-tag' }, st)),
                              ),
                            ),
                          ),
                        )
                      : h('span', { className: 'smem-subtitle' }, t('envEmptyNone')),
                  ),

                  // Card 4: User Services
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(ServerIcon, { React, size: 14 }), t('envCardServices')),
                      h('span', { className: 'smem-tab-count' }, String(envSnap.services?.length || 0)),
                    ),
                    envSnap.services?.length
                      ? h(
                          'div',
                          { className: 'smem-kv-list' },
                          ...envSnap.services.map((s) =>
                            h(
                              'div',
                              { key: s.name, className: 'smem-kv-row' },
                              h(
                                'span',
                                { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 } },
                                h('span', { className: `smem-dot ${s.status || ''}` }),
                                s.name,
                                h('span', { className: 'smem-tag' }, s.status || 'configured'),
                              ),
                              h('span', { className: 'smem-kv-val' }, s.command || s.directory || '—'),
                            ),
                          ),
                        )
                      : h('span', { className: 'smem-subtitle' }, t('envEmptyNone')),
                  ),

                  // Card 5: Exposed Routes
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(GlobeIcon, { React, size: 14 }), t('envCardRoutes')),
                      h('span', { className: 'smem-tab-count' }, String(envSnap.routes?.length || 0)),
                    ),
                    envSnap.routes?.length
                      ? h(
                          'div',
                          { className: 'smem-kv-list' },
                          ...envSnap.routes.map((r) =>
                            h(
                              'div',
                              { key: r.name, className: 'smem-kv-row' },
                              h('span', { style: { fontWeight: 600 } }, `${r.name} (${r.target})`),
                              h('span', { className: 'smem-kv-val' }, r.publicUrl || r.mountPath),
                            ),
                          ),
                        )
                      : h('span', { className: 'smem-subtitle' }, t('envEmptyNone')),
                  ),

                  // Card 6: Cron Jobs
                  h(
                    'div',
                    { className: 'smem-env-card' },
                    h(
                      'div',
                      { className: 'smem-env-card-head' },
                      h('span', { className: 'smem-env-card-title' }, h(ClockIcon, { React, size: 14 }), t('envCardCron')),
                      h('span', { className: 'smem-tab-count' }, String(envSnap.cron?.length || 0)),
                    ),
                    envSnap.cron?.length
                      ? h(
                          'div',
                          { className: 'smem-kv-list' },
                          ...envSnap.cron.map((line, idx) =>
                            h('div', { key: idx, className: 'smem-kv-row' }, h('span', { className: 'smem-kv-val', style: { textAlign: 'left' } }, line)),
                          ),
                        )
                      : h('span', { className: 'smem-subtitle' }, t('envEmptyNone')),
                  ),
                ),
              )
            : null,

          // TAB 3: CONTEXT PREVIEW & POLICY
          activeTab === 'context'
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
                // Exact Prompt Preview
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                  h(
                    'div',
                    { className: 'smem-header', style: { alignItems: 'center' } },
                    h(
                      'div',
                      null,
                      h('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, t('previewTitle')),
                      h('p', { className: 'smem-subtitle' }, t('previewSubtitle')),
                    ),
                    h(
                      'div',
                      { className: 'smem-actions' },
                      h('button', { type: 'button', className: 'smem-btn smem-btn-sm', onClick: handleCopyIndex }, t('btnCopyIndex')),
                      h('button', { type: 'button', className: 'smem-btn smem-btn-sm', onClick: handleExport }, t('btnExport')),
                      h('button', { type: 'button', className: 'smem-btn smem-btn-sm', onClick: () => setShowImport((v) => !v) }, t('btnImport')),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'smem-btn smem-btn-sm smem-btn-danger',
                          disabled: busy || !(stats.bySource?.auto > 0),
                          onClick: () => void controller.clearAutoMemories(),
                        },
                        t('btnClearAuto'),
                      ),
                    ),
                  ),

                  showImport
                    ? h(
                        'div',
                        { className: 'smem-form-box' },
                        h('strong', { style: { fontSize: '13px' } }, t('importTitle')),
                        h('textarea', {
                          className: 'smem-textarea',
                          value: importText,
                          placeholder: t('importPlaceholder'),
                          onChange: (e) => setImportText(e.target.value),
                        }),
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
                          h(
                            'select',
                            {
                              className: 'smem-select',
                              value: importMode,
                              onChange: (e) => setImportMode(e.target.value),
                            },
                            h('option', { value: 'merge' }, t('importMerge')),
                            h('option', { value: 'replace' }, t('importReplace')),
                          ),
                          h(
                            'div',
                            { style: { display: 'flex', gap: '8px' } },
                            h('button', { type: 'button', className: 'smem-btn smem-btn-sm', onClick: () => setShowImport(false) }, t('btnCancel')),
                            h('button', { type: 'button', className: 'smem-btn smem-btn-sm smem-btn-primary', disabled: busy || !importText.trim(), onClick: handleRunImport }, t('importConfirm')),
                          ),
                        ),
                      )
                    : null,

                  h(
                    'div',
                    { className: 'smem-preview-box' },
                    h(
                      'div',
                      { className: 'smem-preview-head' },
                      h('span', null, t('previewGuideLabel')),
                      h('span', { className: 'smem-badge' }, `~${budget.guideTokens ?? 0} ${t('tokenUnit')}`),
                    ),
                    h('pre', { className: 'smem-preview-pre' }, preview.guideText || t('previewEmpty')),
                  ),
                  h(
                    'div',
                    { className: 'smem-preview-box' },
                    h(
                      'div',
                      { className: 'smem-preview-head' },
                      h('span', null, t('previewEnvLabel')),
                      h('span', { className: 'smem-badge' }, `~${budget.envTokens ?? 0} ${t('tokenUnit')}`),
                    ),
                    h('pre', { className: 'smem-preview-pre' }, preview.envText || t('previewEmpty')),
                  ),
                  h(
                    'div',
                    { className: 'smem-preview-box' },
                    h(
                      'div',
                      { className: 'smem-preview-head' },
                      h(
                        'span',
                        null,
                        t('previewIndexLabel'),
                        ' · ',
                        h(
                          'span',
                          { style: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
                          t('previewIncludedSummary', {
                            included: budget.includedCount ?? 0,
                            total: budget.totalEnabledCount ?? 0,
                            omitted: budget.omittedCount ?? 0,
                          }),
                        ),
                      ),
                      h('span', { className: 'smem-badge' }, `~${budget.indexTokens ?? 0} ${t('tokenUnit')}`),
                    ),
                    h('pre', { className: 'smem-preview-pre' }, preview.indexText || t('previewEmpty')),
                  ),
                ),

                // Policy controls
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                  h(
                    'div',
                    null,
                    h('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, t('policyTitle')),
                    h('p', { className: 'smem-subtitle' }, t('policySubtitle')),
                  ),
                  renderPolicySection({
                    React,
                    settings,
                    busy,
                    t,
                    onPatchSettings: (patch) => void controller.saveSettings(patch),
                  }),
                  state.storageDir
                    ? h('div', { className: 'smem-subtitle', style: { fontFamily: 'monospace' } }, `${t('storagePathLabel')}: ${state.storageDir}`)
                    : null,
                ),
              )
            : null,
        ),
      ),
    )
  }
}

export function createMemorySettingsPage({ React, controller, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function MemorySettingsPage() {
    const [, setTick] = React.useState(0)

    React.useEffect(() => {
      const offCtrl = controller.subscribe(() => setTick((n) => n + 1))
      const offLoc = typeof subscribeLocale === 'function'
        ? subscribeLocale(() => setTick((n) => n + 1))
        : () => {}
      void controller.syncFromHost()
      return () => {
        offCtrl()
        offLoc()
      }
    }, [])

    const t = createTranslator(typeof getLocale === 'function' ? getLocale() : 'en')
    const { state, busy } = controller.getSnapshot()
    const settings = state.settings || {}
    const budget = state.preview?.budget || {}

    return h(
      'div',
      { className: 'smem-settings-wrap' },
      h(
        'div',
        { className: 'smem-header' },
        h(
          'div',
          null,
          h('h2', { style: { margin: 0, fontSize: '16px', fontWeight: 600 } }, t('policyTitle')),
          h('p', { className: 'smem-subtitle' }, `${t('policySubtitle')} (~${budget.totalTokens ?? 0} ${t('tokenUnit')})`),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'smem-btn smem-btn-sm',
            disabled: busy,
            onClick: () => void controller.refreshEnvironment(true),
          },
          h(RefreshIcon, { React, size: 13 }),
          t('btnRefreshEnv'),
        ),
      ),
      renderPolicySection({
        React,
        settings,
        busy,
        t,
        onPatchSettings: (patch) => void controller.saveSettings(patch),
      }),
    )
  }
}
