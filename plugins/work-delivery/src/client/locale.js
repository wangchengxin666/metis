export const en = {
  panel: 'Work & Delivery',
  title: 'Work & Delivery Hub',
  subtitle: 'Inspect tasks, approvals, online pages, shared files, and background services. Create or modify anything directly in AI chat.',
  refresh: 'Refresh',
  refreshing: 'Refreshing...',
  sopToggle: 'View Role SOP & Standing Guidelines',
  tabWork: 'Tasks & Pages',
  tabAdvanced: 'Team & Services',

  // Search & Filter & Pagination
  searchPlaceholder: 'Filter tasks, pages, files, or services...',
  filterAll: 'All',
  filterActive: 'Active',
  filterDone: 'Done',
  filterApproval: 'Pending Approval',
  loadMoreBtn: 'Show more ({remaining} remaining)',
  collapseListBtn: 'Collapse',
  noSearchMatch: 'No items match "{query}".',

  // Tasks & Approvals
  tasksTitle: 'Tasks & Human Approvals',
  pendingApprovalsBadge: '{count} pending approval',
  approveBtn: 'Approve',
  rejectBtn: 'Reject',
  tasksEmpty: 'No tasks yet. Tell the AI in chat whenever you want to track a task or approval.',
  markDone: 'Mark Done',
  markOpen: 'Undo Done',
  statusOpen: 'To Do',
  statusInProgress: 'In Progress',
  statusInReview: 'In Review',
  statusBlocked: 'Blocked',
  statusDone: 'Done',
  statusCancelled: 'Cancelled',

  // Published Pages
  appsTitle: 'Published Online Pages & Deliverables',
  appsEmpty: 'No published pages yet. Ask the AI in chat to publish any report, dashboard, or demo page.',
  openAppBtn: 'Open',
  unexposeBtn: 'Remove',

  // Empty-composer inline hint (DSH 0.2.3+ conversation.input.placeholder)
  composerHintDefault: 'Describe a task, request a deliverable, or ask to publish an online preview page…',
  composerHintRole: 'Ask {role} to complete a task, capture an approval, or publish an online deliverable…',

  // AI Usage & Shared Files
  finopsTitle: 'AI Usage & Shared Team Files',
  estimatedTokens: 'Usage: {tokens} tokens ({sessions} sessions · {messages} messages)',
  sharedFilesTitle: 'Shared Team Files (/home/workspace/shared)',
  sharedFilesEmpty: 'No shared project files yet.',
  removeBtn: 'Remove',

  // Team & Services
  meshTitle: 'Team Roster & Project Groups',
  peersCount: 'Connected Peers: {count}',
  groupsCount: 'Project Groups: {count}',
  meshEmpty: 'No connected team peers or groups yet. Pair teammates in Collab Space.',
  servicesTitle: 'Background Services (Advanced)',
  servicesEmpty: 'No persistent background services running. Ask the AI in chat whenever a service needs to stay alive in the background.',
  startBtn: 'Start',
  stopBtn: 'Stop',
  restartBtn: 'Restart',
  logsBtn: 'Logs',
  noLogs: '(No logs yet)',

  // Chat Tool Cards
  toolOverviewTitle: 'Work & Delivery Overview',
  toolTaskCreateTitle: 'Capture Work Task',
  toolRunning: 'Running...',
  toolDone: 'Done',
  toolFailed: 'Failed',

  // Toasts
  toastTaskUpdated: 'Task updated',
  toastApproved: 'Approval decision saved',
  toastAppRemoved: 'Online page removed',
  toastServiceOk: 'Service action completed',
  toastError: 'Action failed',
}

export const zh = {
  panel: '工作与交付',
  title: '工作与交付中心',
  subtitle: '集中查看任务进度、待办审批、在线成果页面、团队共享文件与后台服务；新增与修改直接告诉 AI 对话即可。',
  refresh: '刷新',
  refreshing: '刷新中...',
  sopToggle: '展开查看岗位作业规范 (SOP)',
  tabWork: '任务与成果',
  tabAdvanced: '团队协同与后台服务',

  // Search & Filter & Pagination
  searchPlaceholder: '搜索任务、在线页面、共享文件或后台服务...',
  filterAll: '全部',
  filterActive: '进行中',
  filterDone: '已完成',
  filterApproval: '待审批',
  loadMoreBtn: '加载更多（剩余 {remaining} 条）',
  collapseListBtn: '收起',
  noSearchMatch: '没有匹配「{query}」的条目。',

  // Tasks & Approvals
  tasksTitle: '任务看板与人工审批',
  pendingApprovalsBadge: '{count} 项待审批',
  approveBtn: '批准通过',
  rejectBtn: '驳回',
  tasksEmpty: '暂无任务。直接在 AI 对话中交代工作或开启协同任务后将自动显示在这里。',
  markDone: '标记完成',
  markOpen: '撤回完成',
  statusOpen: '待处理',
  statusInProgress: '进行中',
  statusInReview: '待验收',
  statusBlocked: '已阻塞',
  statusDone: '已完成',
  statusCancelled: '已取消',

  // Published Pages
  appsTitle: '在线成果与演示页面',
  appsEmpty: '暂未发布在线成果页面。在 AI 对话中让数字员工发布报告、看板或演示页面后将展示在这里。',
  openAppBtn: '打开查看',
  unexposeBtn: '下线',

  // Empty-composer inline hint (DSH 0.2.3+ conversation.input.placeholder)
  composerHintDefault: '直接交代工作目标，或让我发布在线成果页面与待审批任务…',
  composerHintRole: '向「{role}」派发任务、发起人工审批或发布在线成果页面…',

  // AI Usage & Shared Files
  finopsTitle: 'AI 用量统计与团队共享文件',
  estimatedTokens: '累计用量：{tokens} Tokens（{sessions} 个会话 · {messages} 条消息）',
  sharedFilesTitle: '团队共享文件（/home/workspace/shared）',
  sharedFilesEmpty: '暂无共享项目文件。',
  removeBtn: '移除',

  // Team & Services
  meshTitle: '协作团队与项目群',
  peersCount: '已连接同事：{count}',
  groupsCount: '所在项目群：{count}',
  meshEmpty: '暂未加入项目群或连接同事，可在左侧「协同空间」完成配对。',
  servicesTitle: '后台运行服务（高级）',
  servicesEmpty: '暂无后台运行的常驻服务。如需长驻运行某个应用，直接在 AI 对话中告知数字员工即可。',
  startBtn: '启动',
  stopBtn: '停止',
  restartBtn: '重启',
  logsBtn: '日志',
  noLogs: '（暂无日志）',

  // Chat Tool Cards
  toolOverviewTitle: '查看工作与交付概览',
  toolTaskCreateTitle: '记录工作任务',
  toolRunning: '执行中...',
  toolDone: '已完成',
  toolFailed: '失败',

  // Toasts
  toastTaskUpdated: '任务状态已更新',
  toastApproved: '审批结果已保存',
  toastAppRemoved: '在线页面已下线',
  toastServiceOk: '服务操作已完成',
  toastError: '操作失败',
}

export function resolveLang(raw) {
  return String(raw || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function createTranslator(locale) {
  const dict = resolveLang(locale) === 'zh' ? zh : en
  return (key, vars) => {
    let text = dict[key] ?? en[key] ?? key
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v ?? ''))
      }
    }
    return text
  }
}
