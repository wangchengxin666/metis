export const en = {
  panel: 'Work & Delivery',
  title: 'Work & Delivery Hub',
  subtitle: 'Inspect tasks, approvals, online pages, scheduled routines, and services. Create or modify anything directly in AI chat.',
  refresh: 'Refresh',
  refreshing: 'Refreshing...',
  sopToggle: 'View Role SOP & Standing Guidelines',
  tabWork: 'Tasks & Pages',
  tabSchedule: 'Scheduled Routines',
  tabAdvanced: 'Team & Services',

  // KPI & Prompt bar
  kpiPages: 'Online Pages',
  kpiActiveTasks: 'Active Tasks',
  kpiApprovals: 'Pending Approval',
  kpiSchedules: 'Schedules',
  chatHintPrefix: 'Create via AI chat (click to copy example):',
  promptExamplePage: 'Publish my local demo app as an online shareable link',
  promptExampleCron: 'Set up a weekday 9:00 AM scheduled routine to generate a daily report',
  promptExampleTask: 'Create a task to review Q4 metrics and request my approval when done',
  copiedHint: 'Prompt copied — paste into AI chat',

  // Search & Filter & Pagination
  searchPlaceholder: 'Filter tasks, pages, schedules, files, or services...',
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
  markDone: 'Done',
  markOpen: 'Reopen',
  statusOpen: 'Open',
  statusInProgress: 'In Progress',
  statusDone: 'Done',
  statusCancelled: 'Cancelled',

  // Published Pages
  appsTitle: 'Published Online Pages & Deliverables',
  appsEmpty: 'No published pages yet. Ask the AI in chat to publish any report, dashboard, or demo page.',
  openAppBtn: 'Open',
  unexposeBtn: 'Remove',

  // AI Usage & Shared Files
  finopsTitle: 'AI Usage & Shared Team Files',
  estimatedTokens: 'Estimated usage: {tokens} tokens ({sessions} files · {messages} team messages)',
  sharedFilesTitle: 'Shared Team Files (/home/workspace/shared)',
  sharedFilesEmpty: 'No shared project files yet.',

  // Scheduled Routines
  cronTitle: 'Scheduled Routines',
  cronEmpty: 'No scheduled routines yet. Simply ask the AI in chat, e.g. "Run my daily report every weekday at 9 AM".',
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
  toastCronRemoved: 'Scheduled routine removed',
  toastServiceOk: 'Service action completed',
  toastError: 'Action failed',
}

export const zh = {
  panel: '工作与交付',
  title: '工作与交付中心',
  subtitle: '集中查看任务进度、待办审批、在线成果页面、定时事务与后台服务；新增与修改直接告诉 AI 对话即可。',
  refresh: '刷新',
  refreshing: '刷新中...',
  sopToggle: '展开查看岗位作业规范 (SOP)',
  tabWork: '任务与成果',
  tabSchedule: '定时事务',
  tabAdvanced: '团队协同与高级运维',

  // KPI & Prompt bar
  kpiPages: '在线页面',
  kpiActiveTasks: '进行中任务',
  kpiApprovals: '待人工审批',
  kpiSchedules: '定时事务',
  chatHintPrefix: '通过 AI 对话直接创建（点击复制示例）：',
  promptExamplePage: '把我刚做好的页面发布成一个可分享的在线演示链接',
  promptExampleCron: '帮我设置一个每个工作日早上 9 点自动运行的日报定时事务',
  promptExampleTask: '帮我建一个待办任务：整理本周数据复盘，完成后发给我审批',
  copiedHint: '示例已复制，直接粘贴到 AI 对话即可',

  // Search & Filter & Pagination
  searchPlaceholder: '搜索任务、在线页面、定时事务、共享文件或后台服务...',
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
  markOpen: '重新打开',
  statusOpen: '待处理',
  statusInProgress: '进行中',
  statusDone: '已完成',
  statusCancelled: '已取消',

  // Published Pages
  appsTitle: '在线成果与演示页面',
  appsEmpty: '暂未发布在线成果页面。在 AI 对话中让数字员工发布报告、看板或演示页面后将展示在这里。',
  openAppBtn: '打开查看',
  unexposeBtn: '下线',

  // AI Usage & Shared Files
  finopsTitle: 'AI 用量统计与团队共享文件',
  estimatedTokens: '累计估算用量：{tokens} Tokens（{sessions} 个记录文件 · {messages} 条协同消息）',
  sharedFilesTitle: '团队共享文件（/home/workspace/shared）',
  sharedFilesEmpty: '暂无共享项目文件。',

  // Scheduled Routines
  cronTitle: '定时事务与值守计划',
  cronEmpty: '暂未设置定时事务。直接在 AI 对话中说「每个工作日 9 点帮我跑一份日报」即可自动配置。',
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
  toastCronRemoved: '已移除定时事务',
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
