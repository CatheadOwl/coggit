# Rubric — surface comprehension (hidden from the reviewer)

Answer key per snippet. This file is the human grading key; never sent to the reviewer.

## Snippet A (baseline: minimal overview + bare injection block)

Expected findings — the failure baseline, a fresh reviewer should NOT be able to
derive an obligation:

1. **No actionable before-edit instruction derivable.** "Use it to explore the
   codebase" is permission/description, not an imperative with a trigger. The
   reviewer may guess "maybe read the .md" — acceptable only as a guess without
   a quotable instruction; there is no sentence to quote.
2. **`(stale)` is undefined** in A. No sentence defines it. The reviewer cannot
   know it means "cognition outdated, source current".
3. **No deviation-accounting clause.** Nothing asks to justify skipping.

**Instrument-calibration read:** if reviewers confidently answer 1–3 "yes, with
quotes" for A, the prompt is leading — recalibrate the questions before
trusting any B result. A is the negative control for the instrument itself.

## Snippet B (treatment: same + the cognition-link directive)

1. **Read the linked cognition document before acting on `src/example.ts`.**
   Quotable: "When a [cognition-link] line names a path you are about to read
   or edit, read the linked cognition document before acting on that source
   file".
2. **`(stale)` = the cognition is out of date with its source; treat the
   source as current.** Quotable definition sentence present.
3. **Skipping is allowed but must be accounted**: "if you skip it, say why in
   one line".

## Red flags worth recording (not failures)

- Reviewer reads the directive as a hard prohibition on reading source (it is
  not — default action + allowed deviation).
- Reviewer conflates `(updated)` semantics into the `(stale)` question.
- Reviewer cannot map "the linked cognition document" to the href on the
  `[cognition-link]` line (token-stitching failure of the directive text).
