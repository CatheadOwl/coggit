# coggit comprehension review

This is the comprehension design review described in [`../README.md`](../README.md). `fixtures.json` holds stable raw SDK results; `coggit.review.mjs` projects them live through the current `lib/types/views.js`, and the shared framework assembles them into the blind-review task in `prompt.md`. This way projection changes flow naturally into the experiment, while the reviewer never sees the design intent or `rubric.md`.

Run instructions and artifact conventions live in [`../README.md`](../README.md). When grading manually, check item by item: field meanings, the next action for each scenario, and whether each red flag the reviewer reported is already registered as intentional design in the rubric.
