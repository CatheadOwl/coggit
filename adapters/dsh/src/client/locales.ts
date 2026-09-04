export type CoggitInitLocaleKey =
  | 'tab'
  | 'title'
  | 'loading'
  | 'readyTitle'
  | 'readyBody'
  | 'workspace'
  | 'sourceRoot'
  | 'cognitionRoot'
  | 'sourcePlaceholder'
  | 'cognitionPlaceholder'
  | 'candidateLabel'
  | 'initialize'
  | 'initializing'
  | 'successTitle'
  | 'successBody'
  | 'refresh'
  | 'retry'
  | 'error'

export const en: Record<CoggitInitLocaleKey, string> = {
  tab: 'CogGit',
  title: 'Initialize CogGit',
  loading: 'Checking CogGit status...',
  readyTitle: 'CogGit is already initialized',
  readyBody: 'The runtime will register coggit_* tools for this workspace when this profile starts with the CogGit plugin enabled.',
  workspace: 'Workspace',
  sourceRoot: 'Source root',
  cognitionRoot: 'Cognition root',
  sourcePlaceholder: 'src',
  cognitionPlaceholder: 'src_cognition',
  candidateLabel: 'Detected folders',
  initialize: 'Initialize',
  initializing: 'Initializing...',
  successTitle: 'CogGit initialized',
  successBody: 'Restart this dsh web profile to load the coggit_* tools for the agent runtime.',
  refresh: 'Refresh',
  retry: 'Retry',
  error: 'CogGit initialization failed.',
}

export const zh: Record<CoggitInitLocaleKey, string> = {
  tab: 'CogGit',
  title: '初始化 CogGit',
  loading: '正在检查 CogGit 状态...',
  readyTitle: 'CogGit 已初始化',
  readyBody: '这个 profile 启动并启用 CogGit 插件时，runtime 会自动注册 coggit_* tools。',
  workspace: '工作区',
  sourceRoot: '源代码根目录',
  cognitionRoot: '认知层目录',
  sourcePlaceholder: 'src',
  cognitionPlaceholder: 'src_cognition',
  candidateLabel: '检测到的目录',
  initialize: '初始化',
  initializing: '初始化中...',
  successTitle: 'CogGit 初始化完成',
  successBody: '重启当前 dsh web profile 后，agent runtime 会加载 coggit_* tools。',
  refresh: '刷新',
  retry: '重试',
  error: 'CogGit 初始化失败。',
}
