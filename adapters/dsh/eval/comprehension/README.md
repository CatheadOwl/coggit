# coggit comprehension review

这是 [`../README.md`](../README.md) 所述的理解设计评审。`fixtures.json` 保存稳定的 raw SDK result；`coggit.review.mjs` 通过当前 `lib/types/views.js` 实时投影，再由共享框架组装成 `prompt.md` 中的盲评任务。这样 projection 变化会自然进入实验，同时 reviewer 看不到设计意图与 `rubric.md`。

运行与产物约定见 [`../README.md`](../README.md)。人工评分时逐项检查：字段含义、每个 scenario 的下一步动作、以及 reviewer 报告的 red flag 是否已经属于 rubric 中登记的 intentional design。
