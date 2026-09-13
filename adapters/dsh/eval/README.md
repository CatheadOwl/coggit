---
description: normalized coggit eval — behavior verification and comprehension design review as separate layers
---

# coggit eval

```text
eval/
  behavior/
    real/       # natural-language intent → tool choice; real model
                #   + adoption.experiment.mjs — the cognition-link adoption
                #     experiment (3 arms × N runs; needs the dsh-eval
                #     behavior-experiment release, see its header)
    mock/       # scripted model → real tool pipeline; deterministic
    _fixtures/  # shared workspace fixtures for behavior cases
  comprehension/
    coggit.review.mjs  # comprehension experiment definition
    fixtures.json      # frozen SDK outputs
    prompt.md          # blind-review questions for the reviewer
    rubric.md          # human answer key, never sent to the reviewer
    surface/           # surface review: can a fresh model derive the
                       #   before-edit obligation from the prompt surface alone?
                       #   snippet A = frozen failure baseline (instrument
                       #   calibration), snippet B = + the cognition-link
                       #   directive (projected live from lib)
```

The behavior layer uses the shared `dsh-eval` trace matcher; the comprehension layer uses the shared, model-executor-agnostic review experiment, with a dsh headless adapter launching a fresh reviewer. The two layers answer different questions: the former verifies "did the agent call the right tool, did the write succeed", the latter verifies "is the tool output enough for a fresh model to know the next step". The adoption experiment adds a third question neither answers: "does the standing directive move a *rate* — measured as arms × repetitions with per-arm guards, judged against a pre-registered decision rule, never a CI gate".

```bash
# Working directory: coggit repo root (pnpm --dir works from anywhere)
pnpm --dir adapters/dsh eval:mock
pnpm --dir adapters/dsh eval
pnpm --dir adapters/dsh eval:review
pnpm --dir adapters/dsh eval:review:surface

# Comprehension experiment dry-runs, no model calls (explicit files: directory
# discovery is recursive and would sweep both experiments at once)
dsh-review --dry-run adapters/dsh/eval/comprehension/coggit.review.mjs
dsh-review --dry-run adapters/dsh/eval/comprehension/surface/surface.review.mjs

# Adoption experiment (host-side, credential + spawn; pilot n=10/arm)
node adapters/dsh/eval/behavior/real/adoption.experiment.mjs [--n 10] [--dry]
```

All generated artifacts go into `.runs/` next to the case/experiment and are never committed as SSOT.
