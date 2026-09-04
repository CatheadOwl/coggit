# coggit comprehension findings

Fresh-model blind reviews ([`../coggit.review.mjs`](../coggit.review.mjs), run with `pnpm --dir . eval:review`) surface how an agent with **no design context** reads the projected tool output. This folder is the durable ledger of those findings.

A red flag is a **real design gap only when it is NOT already documented** in [`../rubric.md`](../rubric.md)'s "Known intentional design" list. The loop is:

1. run the review → collect the reviewer's confusions;
2. triage each: `intentional` (rubric-covered) / `fixture` (too-minimal frozen input) / `genuine` (real gap in this adapter, or in the coggit core);
3. resolve: fix the description/fixture/projection here, add the rationale to the rubric, or escalate to the coggit core repo;
4. re-run → confirm **convergence**: the remaining flags are all `intentional`.

## Entry format

Each dated entry records one review round. Per finding:

- **Finding** — the reviewer's red flag (quoted / paraphrased).
- **Triage** — `intentional` | `fixture` | `genuine`.
- **Resolution** — what changed, or why it was accepted as-is.
- **Status** — `resolved` | `accepted` | `open` (open = still unresolved, tracked here).

`open` items are the backlog for the next design round; everything else should be re-runnable and stable.

## Entries

- [2026-08-19 — status format + workflow](2026-08-19-status-format-review.md)
