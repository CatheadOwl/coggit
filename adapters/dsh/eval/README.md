---
description: coggit 的规范化 eval：行为验证与理解设计评审分层
---

# coggit eval

```text
eval/
  behavior/
    real/       # 自然语言意图 → 工具选择；真实模型
    mock/       # 脚本化模型 → 真实工具管线；确定性
    _fixtures/  # 行为 case 共用工作区 fixture
  comprehension/
    coggit.review.mjs  # 理解实验定义
    fixtures.json      # 冻结 SDK 输入
    prompt.md          # reviewer 盲评问题
    rubric.md          # 人工答案键，不发送给 reviewer
```

行为层使用共享 `dsh-eval` trace matcher；理解层使用共享、与模型执行器无关的 review experiment，再由 dsh headless adapter 启动 fresh reviewer。两层回答不同问题：前者验证“agent 有没有调用正确工具、写入是否成功”，后者验证“工具输出是否足以让新模型知道下一步”。

```bash
# 工作目录：仓库根（pnpm --dir 形式从任意目录均可）
pnpm --dir dsh-plugin-dev/coggit eval:mock
pnpm --dir dsh-plugin-dev/coggit eval
pnpm --dir dsh-plugin-dev/coggit eval:review

# 理解实验 dry-run，不调用模型
node dsh-plugin-dev/eval/bin/dsh-review.mjs --dry-run \
  dsh-plugin-dev/coggit/eval/comprehension
```

所有生成物进入 case/experiment 旁的 `.runs/`，不作为 SSOT 提交。
