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
                #   + convention.experiment.mjs — the cognition-gated (v2)
                #     variant: the mirror carries an invariant the edit
                #     violates; outcome metrics blindEdit / adjustedTo44
                #   + glance.experiment.mjs — the noise-salience (round-3)
                #     variant: multi-file workspace, multi-path prompt, several
                #     competing injection lines; metrics glance rate +
                #     firstGlanceIndex (+ distractorMirrorReads noise side)
    composition/ # self-composed host topology the per-run-process face
                #   cannot express: cross-session.regression.mjs drives TWO
                #   sequential main sessions through ONE headless host
                #   (eval-mock model — deterministic, no credential) and
                #   asserts BOTH receive the cognition-link injection; the
                #   negative control (pre-fix provider) goes RED on session 2
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
    genre/             # line-genre review: does a fresh model classify the
                       #   injected [cognition-link] lines as addressed-to-it
                       #   or as background metadata — and does one candidate
                       #   zero-imposition genre clause (snippet C) move that
                       #   classification? the rubric carries the landing rule
```

The behavior layer uses the shared `dsh-eval` trace matcher; the comprehension layer uses the shared, model-executor-agnostic review experiment, with a dsh headless adapter launching a fresh reviewer. The two layers answer different questions: the former verifies "did the agent call the right tool, did the write succeed", the latter verifies "is the tool output enough for a fresh model to know the next step". The adoption experiment adds a third question neither answers: "does the standing directive move a *rate* — measured as arms × repetitions with per-arm guards, judged against a pre-registered decision rule, never a CI gate".

```bash
# Working directory: coggit repo root (pnpm --dir works from anywhere)
pnpm --dir adapters/dsh eval:mock
pnpm --dir adapters/dsh eval
pnpm --dir adapters/dsh eval:review
pnpm --dir adapters/dsh eval:review:surface
pnpm --dir adapters/dsh eval:review:genre
pnpm --dir adapters/dsh eval:glance

# Comprehension experiment dry-runs, no model calls (explicit files: directory
# discovery is recursive and would sweep the experiments at once)
dsh-review --dry-run adapters/dsh/eval/comprehension/coggit.review.mjs
dsh-review --dry-run adapters/dsh/eval/comprehension/surface/surface.review.mjs
dsh-review --dry-run adapters/dsh/eval/comprehension/genre/genre.review.mjs

# Adoption experiment (host-side, credential + spawn; pilot n=10/arm)
node adapters/dsh/eval/behavior/real/adoption.experiment.mjs [--n 10] [--dry]

# Noise-salience glance experiment (round 3; same host-side conventions)
node adapters/dsh/eval/behavior/real/glance.experiment.mjs [--n 10] [--dry]

# Cross-session delivery regression (issue 20260913 #3; composition topology,
# one host + two sequential sessions, deterministic mock model — no credential)
pnpm --dir adapters/dsh eval:cross-session
```

All generated artifacts go into `.runs/` next to the case/experiment and are never committed as SSOT.
