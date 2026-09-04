---
description: normalized coggit eval — behavior verification and comprehension design review as separate layers
---

# coggit eval

```text
eval/
  behavior/
    real/       # natural-language intent → tool choice; real model
    mock/       # scripted model → real tool pipeline; deterministic
    _fixtures/  # shared workspace fixtures for behavior cases
  comprehension/
    coggit.review.mjs  # comprehension experiment definition
    fixtures.json      # frozen SDK outputs
    prompt.md          # blind-review questions for the reviewer
    rubric.md          # human answer key, never sent to the reviewer
```

The behavior layer uses the shared `dsh-eval` trace matcher; the comprehension layer uses the shared, model-executor-agnostic review experiment, with a dsh headless adapter launching a fresh reviewer. The two layers answer different questions: the former verifies "did the agent call the right tool, did the write succeed", the latter verifies "is the tool output enough for a fresh model to know the next step".

```bash
# Working directory: coggit repo root (pnpm --dir works from anywhere)
pnpm --dir adapters/dsh eval:mock
pnpm --dir adapters/dsh eval
pnpm --dir adapters/dsh eval:review

# Comprehension experiment dry-run, no model calls
dsh-review --dry-run adapters/dsh/eval/comprehension
```

All generated artifacts go into `.runs/` next to the case/experiment and are never committed as SSOT.
