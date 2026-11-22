export type Locale = 'zh-CN' | 'en'

export const LOCALE_STORAGE_KEY = 'dsh_manager_locale'
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export interface StorageReader {
  getItem(key: string): string | null
}

export interface StorageWriter {
  setItem(key: string, value: string): void
}

export interface DetectLocaleOptions {
  storage?: StorageReader | null
  navigatorLanguage?: string | null
  navigatorLanguages?: readonly string[] | null
}

/**
 * Normalize raw locale identifiers (e.g. "zh", "zh-Hans", "en-US") into supported locales.
 */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

/**
 * Resolve the initial UI locale from persisted storage first, then browser preferences.
 */
export function detectInitialLocale(options: DetectLocaleOptions = {}): Locale {
  let storage = options.storage
  if (storage === undefined) {
    try {
      storage = typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null
    } catch {
      storage = null
    }
  }

  if (storage) {
    try {
      const saved = normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY))
      if (saved) return saved
    } catch {
      // Ignore storage access errors in restricted browser contexts.
    }
  }

  const candidates: string[] = []
  if (options.navigatorLanguages !== undefined) {
    if (options.navigatorLanguages) {
      candidates.push(...options.navigatorLanguages)
    }
  } else if (typeof globalThis !== 'undefined' && globalThis.navigator?.languages) {
    candidates.push(...globalThis.navigator.languages)
  }

  if (options.navigatorLanguage !== undefined) {
    if (options.navigatorLanguage) {
      candidates.push(options.navigatorLanguage)
    }
  } else if (typeof globalThis !== 'undefined' && globalThis.navigator?.language) {
    candidates.push(globalThis.navigator.language)
  }

  for (const candidate of candidates) {
    const matched = normalizeLocale(candidate)
    if (matched) return matched
  }

  return DEFAULT_LOCALE
}

/**
 * Persist the selected locale in browser storage when available.
 */
export function persistLocale(locale: Locale, storage?: StorageWriter | null): void {
  let target = storage
  if (target === undefined) {
    try {
      target = typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null
    } catch {
      target = null
    }
  }
  if (!target) return
  try {
    target.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

/**
 * Pick localized API text fields such as plugin display names and descriptions.
 */
export function pickLocalizedText(
  locale: Locale,
  zhText?: string | null,
  enText?: string | null,
  fallback = '',
): string {
  if (locale === 'en') {
    return enText || zhText || fallback
  }
  return zhText || enText || fallback
}

const zhCN = {
  // App shell & header
  'app.documentTitle': 'DSH Sandbox Cloud',
  'app.checkingSession': '正在加载...',
  'app.nav.admin': '控制台',
  'app.nav.my': '我的工作区',
  'app.role.admin': '管理员',
  'app.role.user': '用户',
  'app.logout': '退出',
  'app.loggedOut': '已退出登录',
  'app.localeToggleLabel': '切换语言',

  // Login view
  'login.title': '登录 DSH Sandbox Cloud',
  'login.disabledBanner': '账号已被禁用，请联系管理员启用。',
  'login.domainNotAllowedBanner': '该邮箱域名不在当前 OIDC 提供方的允许范围内，请切换其他登录方式或联系管理员。',
  'login.oidcFailedBanner': 'OIDC 单点登录失败或已取消，请重试或改用其他登录方式。',
  'login.oidcNoEmailBanner': 'OIDC 提供方未返回有效邮箱字段，请联系管理员检查 Email Claim 配置。',
  'login.oidcDisabledBanner': '所选的 OIDC 登录入口不存在或已停用，请选择其他方式登录。',
  'login.oidcSectionTitle': '单点登录 (OIDC)',
  'login.oidcButton': '企业单点登录 (SSO)',
  'login.oidcProviderButton': '使用 {name} 登录',
  'login.orLocalDivider': '或使用本地账号',
  'login.adminFallbackToggle': '管理员口令应急登录',
  'login.noMethodsAvailable': '当前未启用任何可用的登录方式，请联系平台管理员检查配置。',
  'login.modeAdmin': '管理员',
  'login.modeUser': '普通用户',
  'login.adminEmailLabel': '管理员邮箱',
  'login.userEmailLabel': '邮箱',
  'login.tokenLabel': '管理员口令',
  'login.tokenPlaceholder': '输入管理员口令',
  'login.passwordLabel': '密码',
  'login.passwordPlaceholder': '输入密码',
  'login.submitting': '登录中...',
  'login.submitAdmin': '登录控制台',
  'login.submitUser': '登录',
  'login.success': '登录成功',
  'login.failed': '登录失败',

  // Common actions & states
  'common.copied': '已复制',
  'common.copyFailed': '自动复制失败，请手动复制',
  'common.refresh': '刷新',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.saving': '保存中...',
  'common.active': '正常',
  'common.disabled': '已禁用',
  'common.inactive': '停用',
  'common.unknown': '未知',

  // Sandbox statuses & actions
  'status.running': '运行中',
  'status.stopped': '已停止',
  'status.exited': '已停止',
  'status.creating': '创建中',
  'status.starting': '启动中',
  'status.restarting': '重启中',
  'status.paused': '已暂停',
  'status.error': '异常',
  'action.start': '启动',
  'action.stop': '停止',
  'action.restart': '重启',
  'action.recreate': '重建',

  // Admin notifications
  'admin.loadFailed': '加载数据失败',
  'admin.sandboxProvisioned': '沙箱已成功分配给 {email}',
  'admin.sandboxCreateFailed': '创建沙箱失败',
  'admin.sandboxActionRunning': '正在{action} {slug}...',
  'admin.sandboxActionSuccess': '{slug} {action}成功',
  'admin.sandboxUpdated': '{slug} 配置已更新',
  'admin.sandboxDestroyed': '{slug} 已销毁',
  'admin.noLogs': '(暂无日志)',
  'admin.logsLoadFailed': '读取日志失败: {message}',
  'admin.templateUpdated': '模板 "{name}" 已更新',
  'admin.templateCreated': '模板 "{name}" 已创建',
  'admin.templateDeleteConfirm': '确定删除模板 "{name} ({key})" 吗？',
  'admin.templateDeleted': '模板 {key} 已删除',
  'admin.pluginsSyncing': '正在同步插件配置...',
  'admin.pluginsSynced': '已同步 {count} 个运行中沙箱',
  'admin.pluginsReinstalling': '正在推送更新内置插件...',
  'admin.pluginsReinstalled': '已更新 {count} 个运行中沙箱的插件',
  'admin.pluginsSyncFailed': '同步失败',
  'admin.llmSaved': '模型配置已保存',
  'admin.llmDeleted': '模型配置已删除',
  'admin.llmPushing': '正在将模型「{name}」推送到 {count} 个沙箱并热重启 DSH...',
  'admin.llmPushed': '已将「{name}」推送到 {synced}/{total} 个沙箱',
  'admin.llmPushFailed': '推送模型配置失败',
  'admin.userAdded': '已添加用户 {email}',
  'admin.userEnabled': '已启用 {email}',
  'admin.userDisabled': '已禁用 {email}',
  'admin.userDeleted': '已删除 {email}',
  'admin.adminAdded': '已添加管理员',
  'admin.passwordUpdated': '已更新 {email} 的密码',

  // Admin KPI cards & tabs
  'admin.kpi.sandboxesTitle': '运行中 / 总沙箱',
  'admin.kpi.quotaTitle': '已分配 CPU',
  'admin.kpi.quotaUnit': 'vCPU',
  'admin.kpi.templatesTitle': '环境模板',
  'admin.kpi.templatesUnit': '个',
  'admin.kpi.pluginsTitle': '内置插件',
  'admin.kpi.pluginsUnit': '个',

  'admin.tabs.sandboxes': '沙箱',
  'admin.tabs.templates': '模板',
  'admin.tabs.plugins': '插件',
  'admin.tabs.llm': '模型',
  'admin.tabs.users': '用户',
  'admin.tabs.sso': '认证',
  'admin.newTemplateBtn': '新建模板',
  'admin.provisionSandboxBtn': '新建沙箱',

  // Tab 1: Sandboxes
  'admin.sandboxes.colWorkspace': '工作区',
  'admin.sandboxes.colTemplate': '模板与规格',
  'admin.sandboxes.colStatus': '状态',
  'admin.sandboxes.colResources': '资源',
  'admin.sandboxes.colActions': '操作',
  'admin.sandboxes.empty': '暂无沙箱，点击右上角「新建沙箱」创建。',
  'admin.sandboxes.notRunning': '未运行',
  'admin.sandboxes.keepAliveBadge': '免休眠',
  'admin.sandboxes.diskCachedLabel': '磁盘 {size}',
  'admin.sandboxes.sleepPolicyTitle': '闲置自动休眠',
  'admin.sandboxes.sleepMinutesUnit': '分钟',
  'admin.sandboxes.sleepEnableLabel': '开启',
  'admin.sandboxes.sleepSaveBtn': '保存',
  'admin.sandboxes.sleepPolicySaved': '休眠策略已保存',
  'admin.sandboxes.openWorkspace': '打开',
  'admin.sandboxes.stopTooltip': '停止',
  'admin.sandboxes.startTooltip': '启动',
  'admin.sandboxes.restartTooltip': '重启',
  'admin.sandboxes.logsTooltip': '日志',
  'admin.sandboxes.editTooltip': '配置',
  'admin.sandboxes.backupTooltip': '备份与恢复',
  'admin.sandboxes.destroyTooltip': '销毁',

  // Tab 2: Templates
  'admin.templates.imageLabel': '镜像',
  'admin.templates.quotaLabel': '默认配额',
  'admin.templates.pluginsLabel': '预装插件',
  'admin.templates.pluginsNone': '无',
  'admin.templates.provisionBtn': '创建沙箱',
  'admin.templates.editBtn': '编辑',
  'admin.templates.localImagesToggle': '本机可用镜像 ({count})',

  // Tab 3: Plugins
  'admin.plugins.title': '插件管理',
  'admin.plugins.syncBtn': '同步索引',
  'admin.plugins.reinstallAllBtn': '推送更新全部内置插件',
  'admin.plugins.reinstallOneBtn': '推送到运行中沙箱',
  'admin.plugins.devDetailsToggle': '源地址与安装命令',
  'admin.plugins.indexUrlLabel': '索引地址',
  'admin.plugins.npmUrlLabel': 'npm 地址',
  'admin.plugins.downloadTgz': '下载 .tgz',
  'admin.plugins.viewPackument': 'Packument',

  // Tab 4: LLM Profiles
  'admin.llm.addTitle': '添加模型',
  'admin.llm.editTitle': '编辑模型',
  'admin.llm.nameLabel': '名称',
  'admin.llm.namePlaceholder': '例如：DeepSeek 官方',
  'admin.llm.apiProtocolLabel': '接口协议',
  'admin.llm.baseUrlLabel': 'Base URL',
  'admin.llm.modelLabel': '模型 ID',
  'admin.llm.apiKeyLabel': 'API Key（本地模型可留空）',
  'admin.llm.apiKeyEditHint': '留空则保持原 API Key 不变',
  'admin.llm.contextWindowLabel': '上下文长度 (Context Window)',
  'admin.llm.maxTokensLabel': '最大输出长度 (Max Tokens)',
  'admin.llm.supportsImageLabel': '支持图片 / 视觉输入 (Vision)',
  'admin.llm.reasoningEffortLabel': '思考深度 (Reasoning Effort)',
  'admin.llm.reasoningAuto': '默认（不指定）',
  'admin.llm.reasoningOff': '关闭 (off)',
  'admin.llm.reasoningMinimal': '极简 (minimal)',
  'admin.llm.reasoningLow': '低 (low)',
  'admin.llm.reasoningMedium': '中 (medium)',
  'admin.llm.reasoningHigh': '高 (high)',
  'admin.llm.reasoningXhigh': '极高 (xhigh)',
  'admin.llm.reasoningMax': '最大 (max)',
  'admin.llm.thinkingFormatLabel': '思考参数协议（可选）',
  'admin.llm.thinkingFormatAuto': '自动检测',
  'admin.llm.thinkingFormatCompletionsOnly': '仅 openai-completions 协议可用',
  'admin.llm.badgeVision': '支持图片',
  'admin.llm.badgeThinking': '思考',
  'admin.llm.badgeKeySet': '已配 Key',
  'admin.llm.badgeNoKey': '免 Key',
  'admin.llm.saveBtn': '保存',
  'admin.llm.updateBtn': '更新配置',
  'admin.llm.cancelEditBtn': '取消编辑',
  'admin.llm.listTitle': '已保存模型',
  'admin.llm.empty': '暂无模型配置',
  'admin.llm.pushBtn': '推送到沙箱',
  'admin.llm.boundCount': '{count} 个沙箱',
  'dialog.pushLlm.title': '推送模型配置：{name}',
  'dialog.pushLlm.desc': '无需重建容器：直接热写入 DSH 模型配置与受保护凭据文件并重启 DSH，原有工作区文件与对话历史完全保留。',
  'dialog.pushLlm.targetsLabel': '选择目标沙箱',
  'dialog.pushLlm.selectRunning': '全选运行中 ({count})',
  'dialog.pushLlm.clearAll': '清空',
  'dialog.pushLlm.noSandboxes': '当前暂无可用沙箱。',
  'dialog.pushLlm.stoppedSkip': '未运行（需先启动）',
  'dialog.pushLlm.currentModel': '当前：{name}',
  'dialog.pushLlm.setDefaultLabel': '同时设为沙箱默认模型',
  'dialog.pushLlm.replaceManagedLabel': '清理其他由平台推送的旧模型（保留用户在 DSH 内手动添加的模型）',
  'dialog.pushLlm.submit': '立即推送 ({count})',
  'dialog.pushLlm.submitting': '推送中...',
  'dialog.pushLlm.resultTitle': '推送结果',

  // Tab 5: Users, Admins & Audit Log
  'admin.users.title': '用户管理',
  'admin.users.oidcBadge': 'OIDC',
  'admin.users.localBadge': '本地密码',
  'admin.users.hybridBadge': 'OIDC + 本地密码',
  'admin.users.emailPlaceholder': '邮箱 *',
  'admin.users.namePlaceholder': '姓名 (可选)',
  'admin.users.pwPlaceholderOidc': '密码 (可选)',
  'admin.users.pwPlaceholderLocal': '初始密码 (至少6位) *',
  'admin.users.pwGenTitle': '生成随机密码',
  'admin.users.pwGenShort': '随机',
  'admin.users.addBtn': '添加',
  'admin.users.empty': '暂无用户',
  'admin.users.oidcPlusPw': 'OIDC + 密码',
  'admin.users.pwSet': '已设密码',
  'admin.users.pwUnset': '未设密码',
  'admin.users.sandboxCount': '{count} 个沙箱',
  'admin.users.resetPw': '改密',
  'admin.users.setPw': '设密',
  'admin.users.disableBtn': '禁用',
  'admin.users.enableBtn': '启用',
  'admin.users.deleteDisabledTip': '请先删除该用户的沙箱',
  'admin.users.deleteTip': '删除',
  'admin.admins.title': '管理员',
  'admin.admins.emailPlaceholder': '管理员邮箱',
  'admin.admins.namePlaceholder': '姓名 (可选)',
  'admin.admins.addBtn': '添加',
  'admin.audit.title': '操作日志',
  'admin.audit.empty': '暂无日志',

  // Tab 6: Auth Policy & OIDC Providers
  'admin.authPolicy.title': '登录方式策略',
  'admin.authPolicy.allowLocalUserLabel': '允许普通用户使用本地邮箱 + 密码登录',
  'admin.authPolicy.adminFallbackConfigured': '管理员口令兜底：已启用',
  'admin.authPolicy.adminFallbackMissing': '管理员口令未配置',
  'admin.authPolicy.noOidcWarning': '当前尚未启用任何 OIDC 提供方；关闭普通用户本地登录后，普通用户将无法登录。',
  'admin.authPolicy.saved': '登录策略已保存',
  'admin.oidc.addTitle': '添加 OIDC 提供方',
  'admin.oidc.editTitle': '编辑 OIDC 提供方',
  'admin.oidc.listTitle': '已配置 OIDC 提供方',
  'admin.oidc.empty': '尚未配置内部 OIDC 提供方。添加后登录页将直接展示对应的单点登录按钮，无需修改 Docker 环境变量或重启容器。',
  'admin.oidc.nameLabel': '显示名称 *',
  'admin.oidc.namePlaceholder': '例如：Keycloak / 企业 SSO / Okta',
  'admin.oidc.slugLabel': '唯一标识 (Slug) *',
  'admin.oidc.slugPlaceholder': '例如：keycloak（小写字母、数字、短横线）',
  'admin.oidc.issuerLabel': 'Issuer URL',
  'admin.oidc.issuerPlaceholder': 'https://idp.example.com/realms/main',
  'admin.oidc.clientIdLabel': 'Client ID *',
  'admin.oidc.clientSecretLabel': 'Client Secret',
  'admin.oidc.clientSecretEditHint': '留空则保持原 Secret 不变',
  'admin.oidc.clearSecretLabel': '清空已保存的 Client Secret（切换为 Public Client）',
  'admin.oidc.callbackPreviewTitle': 'IdP 回调配置（点击复制）',
  'admin.oidc.redirectUriLabel': 'Redirect URI',
  'admin.oidc.postLogoutUriLabel': 'Post-Logout URI',
  'admin.oidc.advancedToggle': '高级设置（内网 Discovery / Scope / 域名白名单 / 注销地址）',
  'admin.oidc.discoveryUrlLabel': '内部 Discovery URL（可选，Docker 内网解析用）',
  'admin.oidc.discoveryUrlPlaceholder': 'http://dsh-keycloak:8080/realms/main/.well-known/openid-configuration',
  'admin.oidc.scopeLabel': 'Scope',
  'admin.oidc.emailClaimLabel': '邮箱 Claim 字段',
  'admin.oidc.logoutUrlLabel': '自定义注销 URL（可选）',
  'admin.oidc.allowedDomainsLabel': '允许的邮箱域名白名单（可选，逗号分隔）',
  'admin.oidc.allowedDomainsPlaceholder': '留空不限制，例如：corp.com,example.org',
  'admin.oidc.sortOrderLabel': '排序权重（越小越靠前）',
  'admin.oidc.enabledLabel': '启用此 OIDC 登录入口',
  'admin.oidc.allowAdminLabel': '允许命中管理员列表的邮箱获得管理员权限',
  'admin.oidc.testBtn': '测试发现端点',
  'admin.oidc.testing': '测试中...',
  'admin.oidc.testOk': '发现端点连通正常',
  'admin.oidc.testLogoutYes': '支持单点注销',
  'admin.oidc.testLogoutNo': '无注销端点（将使用 prompt=login）',
  'admin.oidc.saveBtn': '添加提供方',
  'admin.oidc.updateBtn': '更新提供方',
  'admin.oidc.saved': 'OIDC 提供方已保存',
  'admin.oidc.deleted': '已删除 OIDC 提供方 {name}',
  'admin.oidc.deleteConfirm': '确定删除 OIDC 提供方 "{name} ({slug})" 吗？',
  'admin.oidc.toggledOn': '已启用 {name}',
  'admin.oidc.toggledOff': '已停用 {name}',
  'admin.oidc.badgeEnabled': '已启用',
  'admin.oidc.badgeDisabled': '已停用',
  'admin.oidc.badgeAdminAllowed': '允许管理员',
  'admin.oidc.badgeUserOnly': '仅普通用户',
  'admin.oidc.badgeSecretSet': '已配 Secret',
  'admin.oidc.badgeNoSecret': '无 Secret',
  'admin.oidc.badgeDomains': '域名白名单：{domains}',
  'admin.oidc.copyCallbackBtn': '复制回调地址',
  'admin.oidc.testShortBtn': '测试',

  // Dialogs
  'dialog.provision.title': '新建沙箱',
  'dialog.provision.emailLabel': '用户邮箱 *',
  'dialog.provision.nameLabel': '姓名 / 备注',
  'dialog.provision.namePlaceholder': '例如：张三',
  'dialog.provision.pwLabel': '初始密码 (可选)',
  'dialog.provision.pwPlaceholder': '至少 6 位，留空则不修改',
  'dialog.provision.pwGenBtn': '随机',
  'dialog.provision.templateLabel': '环境模板 *',
  'dialog.provision.llmLabel': '默认模型',
  'dialog.provision.llmNone': '不预设',
  'dialog.provision.advancedToggle': '高级选项 (Slug / 镜像 / 配额 / 初始化)',
  'dialog.provision.slugLabel': '自定义路径标识 (Slug)',
  'dialog.provision.slugPlaceholder': '留空自动生成，如 alice',
  'dialog.provision.repoLabel': '镜像仓库',
  'dialog.provision.tagLabel': '镜像 Tag',
  'dialog.provision.cpuLabel': 'CPU (vCPU)',
  'dialog.provision.memLabel': '内存',
  'dialog.provision.pluginsLabel': '预装插件 (逗号分隔)',
  'dialog.provision.repoUrlLabel': '初始 Git 仓库 (可选)',
  'dialog.provision.initScriptLabel': '初始化脚本',
  'dialog.provision.autoSleepExemptLabel': '免自动休眠',
  'dialog.provision.submitting': '创建中...',
  'dialog.provision.submit': '创建沙箱',

  'dialog.template.editTitle': '编辑模板：{name}',
  'dialog.template.createTitle': '新建模板',
  'dialog.template.keyLabel': '模板 Key *',
  'dialog.template.keyPlaceholder': '例如：ai-researcher',
  'dialog.template.nameLabel': '名称 *',
  'dialog.template.namePlaceholder': '例如：AI 研发环境',
  'dialog.template.descLabel': '描述',
  'dialog.template.descPlaceholder': '简要说明（可选）',
  'dialog.template.localPickLabel': '快速选择本机镜像',
  'dialog.template.repoLabel': '镜像仓库 *',
  'dialog.template.tagLabel': '镜像 Tag *',
  'dialog.template.cpuLabel': 'CPU (vCPU)',
  'dialog.template.memLabel': '内存',
  'dialog.template.pluginsLabel': '预装插件 (逗号分隔)',
  'dialog.template.initScriptLabel': '初始化脚本',
  'dialog.template.envJsonLabel': '环境变量 (JSON)',
  'dialog.template.submit': '保存',

  'dialog.editSandbox.title': '配置沙箱：{slug}',
  'dialog.editSandbox.cpuLabel': 'CPU (vCPU)',
  'dialog.editSandbox.memLabel': '内存',
  'dialog.editSandbox.repoLabel': '镜像仓库',
  'dialog.editSandbox.tagLabel': '镜像 Tag',
  'dialog.editSandbox.llmLabel': '绑定模型',
  'dialog.editSandbox.llmNone': '不绑定',
  'dialog.editSandbox.autoSleepExemptLabel': '免自动休眠',
  'dialog.editSandbox.submitting': '保存中...',
  'dialog.editSandbox.submit': '保存',

  'dialog.backup.title': '备份与恢复：{slug}',
  'dialog.backup.exportTitle': '导出备份 (.tar)',
  'dialog.backup.excludeCachesLabel': '排除缓存目录 (node_modules / .venv / .cache)',
  'dialog.backup.downloadBtn': '下载备份',
  'dialog.backup.restoreTitle': '上传恢复',
  'dialog.backup.fileLabel': '备份文件 (.tar / .tar.gz / .tgz)',
  'dialog.backup.modeLabel': '恢复方式',
  'dialog.backup.modeMerge': '合并覆盖（保留现有未包含文件）',
  'dialog.backup.modeClean': '清空后恢复（覆盖整个工作区）',
  'dialog.backup.restoreBtn': '上传并恢复',
  'dialog.backup.restoring': '恢复中...',
  'dialog.backup.restoreSuccess': '已恢复 {count} 个条目',
  'dialog.backup.noFile': '请先选择备份文件',

  'dialog.logs.title': '日志：{slug}',
  'dialog.logs.refresh': '刷新',
  'dialog.logs.copy': '复制日志',
  'dialog.logs.loading': '读取中...',

  'dialog.destroy.title': '销毁沙箱：{slug}',
  'dialog.destroy.owner': '用户：{email}',
  'dialog.destroy.purgeBefore': '同时永久删除数据卷 ',
  'dialog.destroy.purgeAfter': '（不可恢复）',
  'dialog.destroy.confirm': '确认销毁',

  'dialog.resetPw.title': '设置密码：{email}',
  'dialog.resetPw.label': '新密码 (至少 6 位) *',
  'dialog.resetPw.placeholder': '输入新密码',
  'dialog.resetPw.submit': '确认',

  // User Portal (/my)
  'portal.loadFailed': '加载工作区失败',
  'portal.actionRunning': '正在{action}...',
  'portal.actionSuccess': '操作成功',
  'portal.pwMismatch': '两次输入的新密码不一致',
  'portal.pwChanged': '密码已更新',
  'portal.bannerTitle': '我的工作区',
  'portal.accountPrefix': '',
  'portal.changePwBtn': '改密',
  'portal.refreshBtn': '刷新',
  'portal.loadingList': '加载中...',
  'portal.emptyTitle': '暂未分配工作区',
  'portal.emptyBefore': '请联系管理员（',
  'portal.emptyAfter': '）为您分配工作区。',
  'portal.specLabel': '{cpu} vCPU · {memory}',
  'portal.diskLabel': ' · 磁盘 {disk}',
  'portal.openBtn': '进入工作区',
  'portal.startBtn': '启动',
  'portal.stopBtn': '停止',
  'portal.restartBtn': '重启',
  'portal.logsBtn': '日志',
  'portal.backupBtn': '备份',
  'portal.logsTitle': '日志：{slug}',
  'portal.logsCopied': '日志已复制',
  'portal.pwDialogTitle': '修改密码',
  'portal.pwDialogDesc': '{email}',
  'portal.currentPwLabel': '当前密码 *',
  'portal.newPwLabel': '新密码 (至少 6 位) *',
  'portal.confirmPwLabel': '确认新密码 *',
  'portal.submitting': '提交中...',
  'portal.pwSubmit': '保存',
} as const

export type MessageKey = keyof typeof zhCN

const en: Record<MessageKey, string> = {
  // App shell & header
  'app.documentTitle': 'DSH Sandbox Cloud',
  'app.checkingSession': 'Loading...',
  'app.nav.admin': 'Console',
  'app.nav.my': 'My Workspaces',
  'app.role.admin': 'Admin',
  'app.role.user': 'User',
  'app.logout': 'Sign Out',
  'app.loggedOut': 'Signed out',
  'app.localeToggleLabel': 'Switch language',

  // Login view
  'login.title': 'Sign in to DSH Sandbox Cloud',
  'login.disabledBanner': 'This account is disabled. Contact your administrator.',
  'login.domainNotAllowedBanner': 'This email domain is not allowed by the selected OIDC provider. Try another sign-in method or contact an administrator.',
  'login.oidcFailedBanner': 'OIDC sign-in failed or was cancelled. Please retry or use another sign-in method.',
  'login.oidcNoEmailBanner': 'The OIDC provider did not return a valid email claim. Contact an administrator.',
  'login.oidcDisabledBanner': 'The selected OIDC provider is unavailable or disabled. Choose another sign-in method.',
  'login.oidcSectionTitle': 'Single Sign-On (OIDC)',
  'login.oidcButton': 'Enterprise SSO Login',
  'login.oidcProviderButton': 'Sign in with {name}',
  'login.orLocalDivider': 'or local account',
  'login.adminFallbackToggle': 'Admin Token Fallback Sign-In',
  'login.noMethodsAvailable': 'No sign-in methods are currently enabled. Contact your administrator.',
  'login.modeAdmin': 'Admin',
  'login.modeUser': 'User',
  'login.adminEmailLabel': 'Admin Email',
  'login.userEmailLabel': 'Email',
  'login.tokenLabel': 'Admin Token',
  'login.tokenPlaceholder': 'Enter admin token',
  'login.passwordLabel': 'Password',
  'login.passwordPlaceholder': 'Enter password',
  'login.submitting': 'Signing in...',
  'login.submitAdmin': 'Sign In',
  'login.submitUser': 'Sign In',
  'login.success': 'Signed in',
  'login.failed': 'Sign-in failed',

  // Common actions & states
  'common.copied': 'Copied',
  'common.copyFailed': 'Clipboard blocked; please copy manually',
  'common.refresh': 'Refresh',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving...',
  'common.active': 'Active',
  'common.disabled': 'Disabled',
  'common.inactive': 'Inactive',
  'common.unknown': 'Unknown',

  // Sandbox statuses & actions
  'status.running': 'running',
  'status.stopped': 'stopped',
  'status.exited': 'stopped',
  'status.creating': 'creating',
  'status.starting': 'starting',
  'status.restarting': 'restarting',
  'status.paused': 'paused',
  'status.error': 'error',
  'action.start': 'start',
  'action.stop': 'stop',
  'action.restart': 'restart',
  'action.recreate': 'recreate',

  // Admin notifications
  'admin.loadFailed': 'Failed to load data',
  'admin.sandboxProvisioned': 'Sandbox provisioned for {email}',
  'admin.sandboxCreateFailed': 'Failed to create sandbox',
  'admin.sandboxActionRunning': 'Running {action} on {slug}...',
  'admin.sandboxActionSuccess': 'Sandbox {slug} {action} succeeded',
  'admin.sandboxUpdated': '{slug} updated',
  'admin.sandboxDestroyed': '{slug} destroyed',
  'admin.noLogs': '(No logs yet)',
  'admin.logsLoadFailed': 'Failed to load logs: {message}',
  'admin.templateUpdated': 'Template "{name}" updated',
  'admin.templateCreated': 'Template "{name}" created',
  'admin.templateDeleteConfirm': 'Delete template "{name} ({key})"?',
  'admin.templateDeleted': 'Template {key} deleted',
  'admin.pluginsSyncing': 'Syncing plugin index...',
  'admin.pluginsSynced': 'Synced {count} running sandbox(es)',
  'admin.pluginsReinstalling': 'Pushing built-in plugin updates...',
  'admin.pluginsReinstalled': 'Updated plugins on {count} running sandbox(es)',
  'admin.pluginsSyncFailed': 'Sync failed',
  'admin.llmSaved': 'Model saved',
  'admin.llmDeleted': 'Model deleted',
  'admin.llmPushing': 'Pushing "{name}" to {count} sandbox(es) and restarting DSH...',
  'admin.llmPushed': 'Pushed "{name}" to {synced}/{total} sandbox(es)',
  'admin.llmPushFailed': 'Failed to push model configuration',
  'admin.userAdded': 'User {email} added',
  'admin.userEnabled': 'Enabled {email}',
  'admin.userDisabled': 'Disabled {email}',
  'admin.userDeleted': 'Deleted {email}',
  'admin.adminAdded': 'Admin added',
  'admin.passwordUpdated': 'Password updated for {email}',

  // Admin KPI cards & tabs
  'admin.kpi.sandboxesTitle': 'Running / Total',
  'admin.kpi.quotaTitle': 'Allocated CPU',
  'admin.kpi.quotaUnit': 'vCPU',
  'admin.kpi.templatesTitle': 'Templates',
  'admin.kpi.templatesUnit': '',
  'admin.kpi.pluginsTitle': 'Plugins',
  'admin.kpi.pluginsUnit': '',

  'admin.tabs.sandboxes': 'Sandboxes',
  'admin.tabs.templates': 'Templates',
  'admin.tabs.plugins': 'Plugins',
  'admin.tabs.llm': 'Models',
  'admin.tabs.users': 'Users',
  'admin.tabs.sso': 'Auth & SSO',
  'admin.newTemplateBtn': 'New Template',
  'admin.provisionSandboxBtn': 'New Sandbox',

  // Tab 1: Sandboxes
  'admin.sandboxes.colWorkspace': 'Workspace',
  'admin.sandboxes.colTemplate': 'Spec',
  'admin.sandboxes.colStatus': 'Status',
  'admin.sandboxes.colResources': 'Resources',
  'admin.sandboxes.colActions': 'Actions',
  'admin.sandboxes.empty': 'No sandboxes yet. Click "New Sandbox" to create one.',
  'admin.sandboxes.notRunning': 'Stopped',
  'admin.sandboxes.keepAliveBadge': 'Keep Alive',
  'admin.sandboxes.diskCachedLabel': 'Disk {size}',
  'admin.sandboxes.sleepPolicyTitle': 'Idle Auto-Sleep',
  'admin.sandboxes.sleepMinutesUnit': 'min',
  'admin.sandboxes.sleepEnableLabel': 'Enable',
  'admin.sandboxes.sleepSaveBtn': 'Save',
  'admin.sandboxes.sleepPolicySaved': 'Sleep policy saved',
  'admin.sandboxes.openWorkspace': 'Open',
  'admin.sandboxes.stopTooltip': 'Stop',
  'admin.sandboxes.startTooltip': 'Start',
  'admin.sandboxes.restartTooltip': 'Restart',
  'admin.sandboxes.logsTooltip': 'Logs',
  'admin.sandboxes.editTooltip': 'Settings',
  'admin.sandboxes.backupTooltip': 'Backup & Restore',
  'admin.sandboxes.destroyTooltip': 'Destroy',

  // Tab 2: Templates
  'admin.templates.imageLabel': 'Image',
  'admin.templates.quotaLabel': 'Quota',
  'admin.templates.pluginsLabel': 'Plugins',
  'admin.templates.pluginsNone': 'None',
  'admin.templates.provisionBtn': 'Create Sandbox',
  'admin.templates.editBtn': 'Edit',
  'admin.templates.localImagesToggle': 'Local Docker Images ({count})',

  // Tab 3: Plugins
  'admin.plugins.title': 'Plugins',
  'admin.plugins.syncBtn': 'Sync Index',
  'admin.plugins.reinstallAllBtn': 'Push Updates to All Sandboxes',
  'admin.plugins.reinstallOneBtn': 'Push to Running Sandboxes',
  'admin.plugins.devDetailsToggle': 'Registry URLs & CLI',
  'admin.plugins.indexUrlLabel': 'Index URL',
  'admin.plugins.npmUrlLabel': 'npm Registry',
  'admin.plugins.downloadTgz': 'Download .tgz',
  'admin.plugins.viewPackument': 'Packument',

  // Tab 4: LLM Profiles
  'admin.llm.addTitle': 'Add Model',
  'admin.llm.editTitle': 'Edit Model',
  'admin.llm.nameLabel': 'Name',
  'admin.llm.namePlaceholder': 'e.g. DeepSeek API',
  'admin.llm.apiProtocolLabel': 'API Protocol',
  'admin.llm.baseUrlLabel': 'Base URL',
  'admin.llm.modelLabel': 'Model ID',
  'admin.llm.apiKeyLabel': 'API Key (optional for local)',
  'admin.llm.apiKeyEditHint': 'Leave blank to keep existing API Key',
  'admin.llm.contextWindowLabel': 'Context Window',
  'admin.llm.maxTokensLabel': 'Max Output Tokens',
  'admin.llm.supportsImageLabel': 'Supports Image / Vision Input',
  'admin.llm.reasoningEffortLabel': 'Thinking Depth (Reasoning Effort)',
  'admin.llm.reasoningAuto': 'Default (auto)',
  'admin.llm.reasoningOff': 'Off (off)',
  'admin.llm.reasoningMinimal': 'Minimal (minimal)',
  'admin.llm.reasoningLow': 'Low (low)',
  'admin.llm.reasoningMedium': 'Medium (medium)',
  'admin.llm.reasoningHigh': 'High (high)',
  'admin.llm.reasoningXhigh': 'Extra High (xhigh)',
  'admin.llm.reasoningMax': 'Max (max)',
  'admin.llm.thinkingFormatLabel': 'Thinking Wire Format (optional)',
  'admin.llm.thinkingFormatAuto': 'Auto detect',
  'admin.llm.thinkingFormatCompletionsOnly': 'Only for openai-completions',
  'admin.llm.badgeVision': 'Vision',
  'admin.llm.badgeThinking': 'Thinking',
  'admin.llm.badgeKeySet': 'Key set',
  'admin.llm.badgeNoKey': 'No key',
  'admin.llm.saveBtn': 'Save',
  'admin.llm.updateBtn': 'Update Model',
  'admin.llm.cancelEditBtn': 'Cancel',
  'admin.llm.listTitle': 'Saved Models',
  'admin.llm.empty': 'No models saved yet',
  'admin.llm.pushBtn': 'Push to Sandboxes',
  'admin.llm.boundCount': '{count} sandboxes',
  'dialog.pushLlm.title': 'Push Model Config: {name}',
  'dialog.pushLlm.desc': 'No container rebuild required: hot-writes DSH model config and 0600 credentials then restarts DSH while preserving workspace files and chats.',
  'dialog.pushLlm.targetsLabel': 'Select Target Sandboxes',
  'dialog.pushLlm.selectRunning': 'Select Running ({count})',
  'dialog.pushLlm.clearAll': 'Clear',
  'dialog.pushLlm.noSandboxes': 'No sandboxes available.',
  'dialog.pushLlm.stoppedSkip': 'Stopped (start first)',
  'dialog.pushLlm.currentModel': 'Current: {name}',
  'dialog.pushLlm.setDefaultLabel': 'Set as sandbox default model',
  'dialog.pushLlm.replaceManagedLabel': 'Clean up other platform-pushed models (keeps manually added models in DSH)',
  'dialog.pushLlm.submit': 'Push Now ({count})',
  'dialog.pushLlm.submitting': 'Pushing...',
  'dialog.pushLlm.resultTitle': 'Push Results',

  // Tab 5: Users, Admins & Audit Log
  'admin.users.title': 'Users',
  'admin.users.oidcBadge': 'OIDC',
  'admin.users.localBadge': 'Local Auth',
  'admin.users.hybridBadge': 'OIDC + Local',
  'admin.users.emailPlaceholder': 'Email *',
  'admin.users.namePlaceholder': 'Name (optional)',
  'admin.users.pwPlaceholderOidc': 'Password (optional)',
  'admin.users.pwPlaceholderLocal': 'Password (min 6 chars) *',
  'admin.users.pwGenTitle': 'Generate password',
  'admin.users.pwGenShort': 'Random',
  'admin.users.addBtn': 'Add',
  'admin.users.empty': 'No users yet',
  'admin.users.oidcPlusPw': 'OIDC + Password',
  'admin.users.pwSet': 'Password Set',
  'admin.users.pwUnset': 'No Password',
  'admin.users.sandboxCount': '{count} sandbox(es)',
  'admin.users.resetPw': 'Password',
  'admin.users.setPw': 'Set Password',
  'admin.users.disableBtn': 'Disable',
  'admin.users.enableBtn': 'Enable',
  'admin.users.deleteDisabledTip': 'Delete user sandboxes first',
  'admin.users.deleteTip': 'Delete',
  'admin.admins.title': 'Admins',
  'admin.admins.emailPlaceholder': 'Admin email',
  'admin.admins.namePlaceholder': 'Name (optional)',
  'admin.admins.addBtn': 'Add',
  'admin.audit.title': 'Audit Log',
  'admin.audit.empty': 'No logs yet',

  // Tab 6: Auth Policy & OIDC Providers
  'admin.authPolicy.title': 'Sign-In Policy',
  'admin.authPolicy.allowLocalUserLabel': 'Allow local email + password sign-in for regular users',
  'admin.authPolicy.adminFallbackConfigured': 'Admin Token fallback: active',
  'admin.authPolicy.adminFallbackMissing': 'Admin Token not set',
  'admin.authPolicy.noOidcWarning': 'No OIDC provider is enabled yet; disabling local user sign-in will block regular users from signing in.',
  'admin.authPolicy.saved': 'Sign-in policy saved',
  'admin.oidc.addTitle': 'Add OIDC Provider',
  'admin.oidc.editTitle': 'Edit OIDC Provider',
  'admin.oidc.listTitle': 'Configured OIDC Providers',
  'admin.oidc.empty': 'No internal OIDC providers configured yet. Added providers appear immediately on the sign-in page without editing Docker env or restarting.',
  'admin.oidc.nameLabel': 'Display Name *',
  'admin.oidc.namePlaceholder': 'e.g. Keycloak / Corporate SSO / Okta',
  'admin.oidc.slugLabel': 'Slug *',
  'admin.oidc.slugPlaceholder': 'e.g. keycloak (lowercase letters, digits, hyphens)',
  'admin.oidc.issuerLabel': 'Issuer URL',
  'admin.oidc.issuerPlaceholder': 'https://idp.example.com/realms/main',
  'admin.oidc.clientIdLabel': 'Client ID *',
  'admin.oidc.clientSecretLabel': 'Client Secret',
  'admin.oidc.clientSecretEditHint': 'Leave blank to keep existing secret',
  'admin.oidc.clearSecretLabel': 'Clear stored Client Secret (switch to Public Client)',
  'admin.oidc.callbackPreviewTitle': 'IdP Callback URIs (click to copy)',
  'admin.oidc.redirectUriLabel': 'Redirect URI',
  'admin.oidc.postLogoutUriLabel': 'Post-Logout URI',
  'admin.oidc.advancedToggle': 'Advanced (Internal Discovery / Scope / Allowed Domains / Logout)',
  'admin.oidc.discoveryUrlLabel': 'Internal Discovery URL (optional, for Docker networks)',
  'admin.oidc.discoveryUrlPlaceholder': 'http://dsh-keycloak:8080/realms/main/.well-known/openid-configuration',
  'admin.oidc.scopeLabel': 'Scope',
  'admin.oidc.emailClaimLabel': 'Email Claim',
  'admin.oidc.logoutUrlLabel': 'Custom Logout URL (optional)',
  'admin.oidc.allowedDomainsLabel': 'Allowed Email Domains (optional, comma-separated)',
  'admin.oidc.allowedDomainsPlaceholder': 'Leave blank to allow all, e.g. corp.com,example.org',
  'admin.oidc.sortOrderLabel': 'Sort Order (smaller appears first)',
  'admin.oidc.enabledLabel': 'Enable this OIDC provider',
  'admin.oidc.allowAdminLabel': 'Allow platform admin emails via this provider',
  'admin.oidc.testBtn': 'Test Discovery',
  'admin.oidc.testing': 'Testing...',
  'admin.oidc.testOk': 'Discovery endpoint reachable',
  'admin.oidc.testLogoutYes': 'RP logout supported',
  'admin.oidc.testLogoutNo': 'No logout endpoint (uses prompt=login)',
  'admin.oidc.saveBtn': 'Add Provider',
  'admin.oidc.updateBtn': 'Update Provider',
  'admin.oidc.saved': 'OIDC provider saved',
  'admin.oidc.deleted': 'Deleted OIDC provider {name}',
  'admin.oidc.deleteConfirm': 'Delete OIDC provider "{name} ({slug})"?',
  'admin.oidc.toggledOn': 'Enabled {name}',
  'admin.oidc.toggledOff': 'Disabled {name}',
  'admin.oidc.badgeEnabled': 'Enabled',
  'admin.oidc.badgeDisabled': 'Disabled',
  'admin.oidc.badgeAdminAllowed': 'Admin OK',
  'admin.oidc.badgeUserOnly': 'Users Only',
  'admin.oidc.badgeSecretSet': 'Secret set',
  'admin.oidc.badgeNoSecret': 'No secret',
  'admin.oidc.badgeDomains': 'Domains: {domains}',
  'admin.oidc.copyCallbackBtn': 'Copy Callback',
  'admin.oidc.testShortBtn': 'Test',

  // Dialogs
  'dialog.provision.title': 'New Sandbox',
  'dialog.provision.emailLabel': 'User Email *',
  'dialog.provision.nameLabel': 'Name / Note',
  'dialog.provision.namePlaceholder': 'e.g. Alice',
  'dialog.provision.pwLabel': 'Initial Password (optional)',
  'dialog.provision.pwPlaceholder': 'Min 6 chars; leave blank to skip',
  'dialog.provision.pwGenBtn': 'Random',
  'dialog.provision.templateLabel': 'Template *',
  'dialog.provision.llmLabel': 'Model',
  'dialog.provision.llmNone': 'None',
  'dialog.provision.advancedToggle': 'Advanced (Slug / Image / Quota / Init)',
  'dialog.provision.slugLabel': 'Custom Slug',
  'dialog.provision.slugPlaceholder': 'Auto-generated if blank',
  'dialog.provision.repoLabel': 'Image Repo',
  'dialog.provision.tagLabel': 'Image Tag',
  'dialog.provision.cpuLabel': 'CPU (vCPU)',
  'dialog.provision.memLabel': 'Memory',
  'dialog.provision.pluginsLabel': 'Pre-installed Plugins',
  'dialog.provision.repoUrlLabel': 'Git Clone URL (optional)',
  'dialog.provision.initScriptLabel': 'Init Script',
  'dialog.provision.autoSleepExemptLabel': 'Exempt from idle auto-sleep',
  'dialog.provision.submitting': 'Creating...',
  'dialog.provision.submit': 'Create',

  'dialog.template.editTitle': 'Edit Template: {name}',
  'dialog.template.createTitle': 'New Template',
  'dialog.template.keyLabel': 'Key *',
  'dialog.template.keyPlaceholder': 'e.g. ai-researcher',
  'dialog.template.nameLabel': 'Name *',
  'dialog.template.namePlaceholder': 'e.g. AI Research',
  'dialog.template.descLabel': 'Description',
  'dialog.template.descPlaceholder': 'Optional',
  'dialog.template.localPickLabel': 'Quick-select Local Image',
  'dialog.template.repoLabel': 'Image Repo *',
  'dialog.template.tagLabel': 'Image Tag *',
  'dialog.template.cpuLabel': 'CPU (vCPU)',
  'dialog.template.memLabel': 'Memory',
  'dialog.template.pluginsLabel': 'Plugins (comma-separated)',
  'dialog.template.initScriptLabel': 'Init Script',
  'dialog.template.envJsonLabel': 'Env JSON',
  'dialog.template.submit': 'Save',

  'dialog.editSandbox.title': 'Edit Sandbox: {slug}',
  'dialog.editSandbox.cpuLabel': 'CPU (vCPU)',
  'dialog.editSandbox.memLabel': 'Memory',
  'dialog.editSandbox.repoLabel': 'Image Repo',
  'dialog.editSandbox.tagLabel': 'Image Tag',
  'dialog.editSandbox.llmLabel': 'Model',
  'dialog.editSandbox.llmNone': 'None',
  'dialog.editSandbox.autoSleepExemptLabel': 'Exempt from idle auto-sleep',
  'dialog.editSandbox.submitting': 'Saving...',
  'dialog.editSandbox.submit': 'Save',

  'dialog.backup.title': 'Backup & Restore: {slug}',
  'dialog.backup.exportTitle': 'Export (.tar)',
  'dialog.backup.excludeCachesLabel': 'Exclude caches (node_modules / .venv / .cache)',
  'dialog.backup.downloadBtn': 'Download Backup',
  'dialog.backup.restoreTitle': 'Restore from File',
  'dialog.backup.fileLabel': 'Backup Archive (.tar / .tar.gz / .tgz)',
  'dialog.backup.modeLabel': 'Mode',
  'dialog.backup.modeMerge': 'Merge & overwrite',
  'dialog.backup.modeClean': 'Clean & replace',
  'dialog.backup.restoreBtn': 'Upload & Restore',
  'dialog.backup.restoring': 'Restoring...',
  'dialog.backup.restoreSuccess': 'Restored {count} entries',
  'dialog.backup.noFile': 'Select a backup file first',

  'dialog.logs.title': 'Logs: {slug}',
  'dialog.logs.refresh': 'Refresh',
  'dialog.logs.copy': 'Copy',
  'dialog.logs.loading': 'Loading...',

  'dialog.destroy.title': 'Destroy Sandbox: {slug}',
  'dialog.destroy.owner': 'User: {email}',
  'dialog.destroy.purgeBefore': 'Also delete data volume ',
  'dialog.destroy.purgeAfter': ' (irreversible)',
  'dialog.destroy.confirm': 'Destroy',

  'dialog.resetPw.title': 'Set Password: {email}',
  'dialog.resetPw.label': 'New Password (min 6 chars) *',
  'dialog.resetPw.placeholder': 'Enter new password',
  'dialog.resetPw.submit': 'Save',

  // User Portal (/my)
  'portal.loadFailed': 'Failed to load workspaces',
  'portal.actionRunning': 'Running {action}...',
  'portal.actionSuccess': 'Succeeded',
  'portal.pwMismatch': 'Passwords do not match',
  'portal.pwChanged': 'Password updated',
  'portal.bannerTitle': 'My Workspaces',
  'portal.accountPrefix': '',
  'portal.changePwBtn': 'Password',
  'portal.refreshBtn': 'Refresh',
  'portal.loadingList': 'Loading...',
  'portal.emptyTitle': 'No Workspaces Assigned',
  'portal.emptyBefore': 'Contact your administrator (',
  'portal.emptyAfter': ') to provision a workspace.',
  'portal.specLabel': '{cpu} vCPU · {memory}',
  'portal.diskLabel': ' · Disk {disk}',
  'portal.openBtn': 'Open Workspace',
  'portal.startBtn': 'Start',
  'portal.stopBtn': 'Stop',
  'portal.restartBtn': 'Restart',
  'portal.logsBtn': 'Logs',
  'portal.backupBtn': 'Backup',
  'portal.logsTitle': 'Logs: {slug}',
  'portal.logsCopied': 'Logs copied',
  'portal.pwDialogTitle': 'Change Password',
  'portal.pwDialogDesc': '{email}',
  'portal.currentPwLabel': 'Current Password *',
  'portal.newPwLabel': 'New Password (min 6 chars) *',
  'portal.confirmPwLabel': 'Confirm Password *',
  'portal.submitting': 'Saving...',
  'portal.pwSubmit': 'Save',
}

export const translations: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
}

/**
 * Translate a container status code when known, falling back to the raw value.
 */
export function localizeStatus(locale: Locale, status: string): string {
  const key = `status.${status}`
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE]
  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    return dict[key as MessageKey]
  }
  return status
}

/**
 * Translate a container lifecycle action name.
 */
export function localizeAction(
  locale: Locale,
  action: 'start' | 'stop' | 'restart' | 'recreate',
): string {
  return translate(locale, `action.${action}` as MessageKey)
}

/**
 * Translate a message key for the active locale with optional `{name}` interpolation.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number | null | undefined>,
): string {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE]
  const template = dict[key] ?? translations[DEFAULT_LOCALE][key] ?? key
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name] ?? '')
    }
    return match
  })
}
