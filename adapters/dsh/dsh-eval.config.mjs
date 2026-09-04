export default {
  profile: 'coggit-headless',
  // eval 临时工作区非 git 仓库，doc-link gate 会以 git 报错成 blocking 并
  // splice 反馈步骤耗尽脚本——本包 case 测插件面、不测 gate 交互，默认禁
  // gates 行（gate 交互 case 可在 case 级声明 disableRows: [] 显式恢复）。
  disableRows: ['gates'],
}
