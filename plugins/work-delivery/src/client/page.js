import { formatBytes } from '../shared/model.js'
import { createTranslator } from './locale.js'
import {
  CheckIcon,
  ChevronIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshIcon,
  ServerIcon,
  TrashIcon,
  WorkDeliveryNavIcon,
} from './icons.js'

const PAGE_SIZE = 8

function resolveOpenUrl(app) {
  const mount = String(app?.mount_path || '').trim()
  if (mount.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${mount}`
  }
  return app?.url || mount || '#'
}

function statusLabel(status, t) {
  if (status === 'done') return t('statusDone')
  if (status === 'in_progress') return t('statusInProgress')
  if (status === 'cancelled') return t('statusCancelled')
  return t('statusOpen')
}

export function createWorkDeliveryPage({ React, controller, getLocale, subscribeLocale }) {
  const h = React.createElement

  return function WorkDeliveryPage() {
    const [tick, setTick] = React.useState(0)
    const [activeTab, setActiveTab] = React.useState('work')
    const [search, setSearch] = React.useState('')
    const [taskFilter, setTaskFilter] = React.useState('all')
    const [expandedTaskId, setExpandedTaskId] = React.useState('')
    const [taskLimit, setTaskLimit] = React.useState(PAGE_SIZE)
    const [appLimit, setAppLimit] = React.useState(PAGE_SIZE)
    const [fileLimit, setFileLimit] = React.useState(12)

    // Service logs inspection state
    const [logSvc, setLogSvc] = React.useState('')
    const [logText, setLogText] = React.useState('')
    const [loadingLogs, setLoadingLogs] = React.useState(false)

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
    void tick

    const rawLocale = typeof getLocale === 'function' ? getLocale() : 'zh'
    const t = createTranslator(rawLocale)
    const { state, loading, busy, toast } = controller.getSnapshot()

    const q = search.trim().toLowerCase()
    const matchText = (...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q))

    const allApprovals = state.pending_approvals || []
    const allApps = state.exposed_apps || []
    const allServices = state.user_services || []
    const allFiles = state.shared_files || []
    const allTasks = state.tasks || []
    const groups = state.groups || []
    const peers = state.peers || []

    const filteredApps = allApps.filter((a) => matchText(a.name, a.mount_path, a.target))
    const filteredServices = allServices.filter((sv) => matchText(sv.name, sv.command, sv.status))
    const filteredFiles = allFiles.filter((f) => matchText(f.name))
    const filteredTasks = allTasks.filter((tk) => {
      if (!matchText(tk.title, tk.description, tk.assignee_slug, tk.id)) return false
      if (taskFilter === 'active') return tk.status !== 'done' && tk.status !== 'cancelled'
      if (taskFilter === 'done') return tk.status === 'done'
      if (taskFilter === 'approval') return Boolean(tk.approval_required && tk.approval_status === 'pending')
      return true
    })

    const handleToggleLogs = async (name) => {
      if (logSvc === name) {
        setLogSvc('')
        return
      }
      setLogSvc(name)
      setLoadingLogs(true)
      const text = await controller.readServiceLogs(name)
      setLogText(text || t('noLogs'))
      setLoadingLogs(false)
    }

    const renderPagination = (total, limit, setLimit, step = PAGE_SIZE) => {
      if (total <= step) return null
      const remaining = total - limit
      return h(
        'div',
        { className: 'wd-form-row', style: { justifyContent: 'center', paddingTop: '4px' } },
        remaining > 0
          ? h(
              'button',
              { type: 'button', className: 'wd-btn wd-btn-sm', onClick: () => setLimit((n) => n + step) },
              t('loadMoreBtn', { remaining }),
            )
          : null,
        limit > step
          ? h(
              'button',
              { type: 'button', className: 'wd-btn wd-btn-sm', onClick: () => setLimit(step) },
              t('collapseListBtn'),
            )
          : null,
      )
    }

    return h(
      'div',
      { className: 'wd-page' },
      h(
        'div',
        { className: 'wd-scroll' },
        h(
          'div',
          { className: 'wd-container' },

          // Header
          h(
            'div',
            { className: 'wd-header' },
            h(
              'div',
              { className: 'wd-title-wrap' },
              h('div', { className: 'wd-title-badge' }, h(WorkDeliveryNavIcon, { React, size: 20 })),
              h(
                'div',
                null,
                h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
                  h('h1', { className: 'wd-title' }, t('title')),
                  state.role ? h('span', { className: 'wd-badge wd-badge-brand' }, state.role) : null,
                ),
                h('p', { className: 'wd-subtitle' }, state.description || t('subtitle')),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'wd-btn',
                disabled: loading,
                onClick: () => void controller.syncFromHost(),
              },
              h(RefreshIcon, { React, size: 15 }),
              loading ? t('refreshing') : t('refresh'),
            ),
          ),

          // Collapsible SOP (compact, hidden by default)
          state.sop
            ? h(
                'details',
                { className: 'wd-card', style: { padding: '10px 14px' } },
                h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 500, userSelect: 'none' } }, t('sopToggle')),
                h('pre', { className: 'wd-log-box', style: { marginTop: '10px' } }, state.sop),
              )
            : null,

          // Toolbar: 2-Tab Switcher + Conditional Live Search
          h(
            'div',
            { className: 'wd-toolbar' },
            h(
              'div',
              { className: 'wd-tabs', role: 'tablist' },
              [
                { id: 'work', label: t('tabWork'), count: allTasks.length + allApps.length },
                { id: 'advanced', label: t('tabAdvanced'), count: allServices.length },
              ].map((tab) =>
                h(
                  'button',
                  {
                    key: tab.id,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': activeTab === tab.id ? 'true' : 'false',
                    className: `wd-tab${activeTab === tab.id ? ' active' : ''}`,
                    onClick: () => setActiveTab(tab.id),
                  },
                  tab.label,
                  tab.count > 0 ? h('span', { className: 'wd-tab-count' }, String(tab.count)) : null,
                ),
              ),
            ),
            (allTasks.length + allApps.length + allServices.length > 5 || search)
              ? h('input', {
                  className: 'wd-input',
                  style: { minWidth: '240px', flex: '1 1 240px', maxWidth: '380px' },
                  placeholder: t('searchPlaceholder'),
                  value: search,
                  onChange: (e) => {
                    setSearch(e.target.value)
                    setTaskLimit(PAGE_SIZE)
                    setAppLimit(PAGE_SIZE)
                  },
                })
              : null,
          ),

          // TAB 1: Work & Deliverables (Read-Only + Approvals + Open + Pagination)
          activeTab === 'work'
            ? h(
                React.Fragment,
                null,
                // Card 1: Published Online Pages
                h(
                  'div',
                  { className: 'wd-card' },
                  h(
                    'div',
                    { className: 'wd-card-head' },
                    h('span', { className: 'wd-card-title' }, h(GlobeIcon, { React, size: 16 }), t('appsTitle'), h('span', { className: 'wd-badge' }, String(filteredApps.length))),
                  ),
                  filteredApps.length === 0
                    ? h('p', { className: 'wd-muted' }, q ? t('noSearchMatch', { query: search }) : t('appsEmpty'))
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { className: 'wd-grid-2' },
                          filteredApps.slice(0, appLimit).map((app) =>
                            h(
                              'div',
                              { key: app.name, className: 'wd-item' },
                              h(
                                'div',
                                { className: 'wd-item-col' },
                                h('span', { className: 'wd-item-title' }, app.name),
                                h('span', { className: 'wd-mono' }, app.mount_path || app.url),
                              ),
                              h(
                                'div',
                                { className: 'wd-form-row' },
                                h(
                                  'a',
                                  {
                                    href: resolveOpenUrl(app),
                                    target: '_blank',
                                    rel: 'noopener noreferrer',
                                    className: 'wd-btn wd-btn-sm wd-btn-emerald',
                                    style: { textDecoration: 'none' },
                                  },
                                  h(ExternalLinkIcon, { React, size: 13 }),
                                  t('openAppBtn'),
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'wd-btn wd-btn-sm wd-btn-danger',
                                    title: t('unexposeBtn'),
                                    disabled: busy,
                                    onClick: () => void controller.unexposeApp({ name: app.name }),
                                  },
                                  h(TrashIcon, { React, size: 13 }),
                                ),
                              ),
                            ),
                          ),
                        ),
                        renderPagination(filteredApps.length, appLimit, setAppLimit),
                      ),
                ),

                // Card 2: Tasks & Human Approvals (Search + Filter Pills + Expandable Rows + Load More)
                h(
                  'div',
                  { className: 'wd-card' },
                  h(
                    'div',
                    { className: 'wd-card-head' },
                    h('span', { className: 'wd-card-title' }, h(WorkDeliveryNavIcon, { React, size: 16 }), t('tasksTitle'), h('span', { className: 'wd-badge' }, String(filteredTasks.length))),
                    h(
                      'div',
                      { className: 'wd-pills' },
                      [
                        { id: 'all', label: `${t('filterAll')} (${allTasks.length})` },
                        { id: 'active', label: `${t('filterActive')} (${state.active_tasks_count || 0})` },
                        { id: 'done', label: `${t('filterDone')} (${state.done_tasks_count || 0})` },
                        { id: 'approval', label: `${t('filterApproval')} (${allApprovals.length})` },
                      ].map((pf) =>
                        h(
                          'button',
                          {
                            key: pf.id,
                            type: 'button',
                            className: `wd-pill${taskFilter === pf.id ? ' active' : ''}`,
                            onClick: () => { setTaskFilter(pf.id); setTaskLimit(PAGE_SIZE) },
                          },
                          pf.label,
                        ),
                      ),
                    ),
                  ),

                  // Pending Approvals Strip
                  allApprovals.map((ap) =>
                    h(
                      'div',
                      { key: ap.id, className: 'wd-item wd-approval-row' },
                      h(
                        'div',
                        { className: 'wd-item-col' },
                        h('span', { className: 'wd-item-title' }, ap.title),
                        h('span', { className: 'wd-mono' }, `#${ap.id}${ap.assignee_slug ? ` · @${ap.assignee_slug}` : ''}`),
                      ),
                      h(
                        'div',
                        { className: 'wd-form-row' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'wd-btn wd-btn-sm wd-btn-emerald',
                            disabled: busy,
                            onClick: () => void controller.decideApproval({ taskId: ap.id, decision: 'approved', roomId: ap.room_id }),
                          },
                          h(CheckIcon, { React, size: 13 }),
                          t('approveBtn'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'wd-btn wd-btn-sm wd-btn-danger',
                            disabled: busy,
                            onClick: () => void controller.decideApproval({ taskId: ap.id, decision: 'rejected', roomId: ap.room_id }),
                          },
                          t('rejectBtn'),
                        ),
                      ),
                    ),
                  ),

                  // Compact Expandable Task List with Pagination
                  filteredTasks.length === 0
                    ? h('p', { className: 'wd-muted' }, q ? t('noSearchMatch', { query: search }) : t('tasksEmpty'))
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
                          filteredTasks.slice(0, taskLimit).map((tk) => {
                            const isOpen = expandedTaskId === tk.id
                            return h(
                              'div',
                              { key: tk.id, className: 'wd-task-wrap' },
                              h(
                                'div',
                                {
                                  className: 'wd-task-head',
                                  onClick: () => setExpandedTaskId(isOpen ? '' : tk.id),
                                },
                                h(
                                  'div',
                                  { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '1 1 auto' } },
                                  h(ChevronIcon, { React, size: 14, expanded: isOpen }),
                                  h(
                                    'span',
                                    {
                                      className: 'wd-item-title',
                                      style: tk.status === 'done' ? { textDecoration: 'line-through', opacity: 0.7 } : undefined,
                                    },
                                    tk.title,
                                  ),
                                ),
                                h(
                                  'div',
                                  { className: 'wd-form-row', style: { flexShrink: 0 } },
                                  tk.assignee_slug ? h('span', { className: 'wd-mono' }, `@${tk.assignee_slug}`) : null,
                                  h('span', { className: `wd-badge${tk.status === 'done' ? ' wd-badge-ok' : ''}` }, statusLabel(tk.status, t)),
                                  h(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'wd-btn wd-btn-sm',
                                      disabled: busy,
                                      onClick: (e) => {
                                        e.stopPropagation()
                                        void controller.updateTaskStatus({
                                          taskId: tk.id,
                                          status: tk.status === 'done' ? 'open' : 'done',
                                          roomId: tk.room_id,
                                        })
                                      },
                                    },
                                    tk.status === 'done' ? t('markOpen') : t('markDone'),
                                  ),
                                ),
                              ),
                              isOpen
                                ? h(
                                    'div',
                                    { className: 'wd-task-detail' },
                                    tk.description || `#${tk.id} · ${tk.priority || 'normal'}`,
                                  )
                                : null,
                            )
                          }),
                        ),
                        renderPagination(filteredTasks.length, taskLimit, setTaskLimit),
                      ),
                ),

                // Card 3: AI Usage & Shared Team Files (Paginated)
                h(
                  'div',
                  { className: 'wd-card' },
                  h('span', { className: 'wd-card-title' }, t('finopsTitle')),
                  h(
                    'p',
                    { className: 'wd-muted' },
                    t('estimatedTokens', {
                      tokens: (state.token_usage?.estimated_tokens || 0).toLocaleString(),
                      sessions: state.token_usage?.sessions_count || 0,
                      messages: state.token_usage?.messages_count || 0,
                    }),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    h('div', { style: { fontWeight: 500, fontSize: '13.5px' } }, `${t('sharedFilesTitle')} (${filteredFiles.length})`),
                    filteredFiles.length === 0
                      ? h('p', { className: 'wd-muted' }, q ? t('noSearchMatch', { query: search }) : t('sharedFilesEmpty'))
                      : h(
                          React.Fragment,
                          null,
                          h(
                            'div',
                            { className: 'wd-form-row' },
                            filteredFiles.slice(0, fileLimit).map((f) =>
                              h('span', { key: f.name, className: 'wd-badge' }, `${f.name} (${formatBytes(f.size_bytes)})`),
                            ),
                          ),
                          renderPagination(filteredFiles.length, fileLimit, setFileLimit, 12),
                        ),
                  ),
                ),
              )
            : null,

          // TAB 2: Team & Background Services (Read-Only + Light Runtime Controls)
          activeTab === 'advanced'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'wd-card' },
                  h(
                    'div',
                    { className: 'wd-card-head' },
                    h('span', { className: 'wd-card-title' }, t('meshTitle')),
                    h(
                      'div',
                      { className: 'wd-form-row' },
                      h('span', { className: 'wd-badge' }, t('peersCount', { count: peers.length })),
                      h('span', { className: 'wd-badge' }, t('groupsCount', { count: groups.length })),
                    ),
                  ),
                  peers.length === 0 && groups.length === 0
                    ? h('p', { className: 'wd-muted' }, t('meshEmpty'))
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                        peers.length > 0
                          ? h(
                              'div',
                              { className: 'wd-form-row' },
                              peers.map((p) => h('span', { key: p.slug, className: 'wd-badge' }, `@${p.slug}${p.role ? ` · ${p.role}` : ''}`)),
                            )
                          : null,
                        groups.length > 0
                          ? h(
                              'div',
                              { className: 'wd-form-row' },
                              groups.map((g) => h('span', { key: g.id, className: 'wd-badge wd-badge-brand' }, `#${g.name} (${g.member_count})`)),
                            )
                          : null,
                      ),
                ),

                h(
                  'div',
                  { className: 'wd-card' },
                  h(
                    'div',
                    { className: 'wd-card-head' },
                    h('span', { className: 'wd-card-title' }, h(ServerIcon, { React, size: 16 }), t('servicesTitle'), h('span', { className: 'wd-badge' }, String(filteredServices.length))),
                  ),
                  filteredServices.length === 0
                    ? h('p', { className: 'wd-muted' }, q ? t('noSearchMatch', { query: search }) : t('servicesEmpty'))
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                        filteredServices.map((svc) => {
                          const running = String(svc.status || '').toUpperCase() === 'RUNNING'
                          return h(
                            'div',
                            { key: svc.name, className: 'wd-item' },
                            h(
                              'div',
                              { className: 'wd-item-col' },
                              h(
                                'div',
                                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                                h('span', { className: 'wd-item-title' }, svc.name),
                                h('span', { className: `wd-badge${running ? ' wd-badge-ok' : ''}` }, svc.status),
                              ),
                              svc.command ? h('span', { className: 'wd-mono' }, svc.command) : null,
                            ),
                            h(
                              'div',
                              { className: 'wd-form-row' },
                              running
                                ? h('button', { type: 'button', className: 'wd-btn wd-btn-sm', disabled: busy, onClick: () => void controller.controlService({ name: svc.name, action: 'stop' }) }, t('stopBtn'))
                                : h('button', { type: 'button', className: 'wd-btn wd-btn-sm wd-btn-emerald', disabled: busy, onClick: () => void controller.controlService({ name: svc.name, action: 'start' }) }, t('startBtn')),
                              h('button', { type: 'button', className: 'wd-btn wd-btn-sm', disabled: busy, onClick: () => void controller.controlService({ name: svc.name, action: 'restart' }) }, t('restartBtn')),
                              h('button', { type: 'button', className: `wd-btn wd-btn-sm${logSvc === svc.name ? ' wd-btn-primary' : ''}`, onClick: () => void handleToggleLogs(svc.name) }, t('logsBtn')),
                              h('button', { type: 'button', className: 'wd-btn wd-btn-sm wd-btn-danger', disabled: busy, title: t('removeBtn'), onClick: () => void controller.removeService({ name: svc.name }) }, h(TrashIcon, { React, size: 13 })),
                            ),
                          )
                        }),
                      ),
                  logSvc
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                        h(
                          'div',
                          { className: 'wd-card-head' },
                          h('span', { className: 'wd-mono' }, `logs: ${logSvc}`),
                          h('button', { type: 'button', className: 'wd-btn wd-btn-sm', onClick: () => setLogSvc('') }, '✕'),
                        ),
                        h('pre', { className: 'wd-log-box' }, loadingLogs ? '...' : logText),
                      )
                    : null,
                ),
              )
            : null,
        ),
      ),

      // Toast
      toast
        ? h(
            'div',
            { className: `wd-toast${toast.kind === 'err' ? ' err' : ''}` },
            `${t(toast.key)}${toast.detail ? `: ${toast.detail}` : ''}`,
          )
        : null,
    )
  }
}
