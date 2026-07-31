# CogGit Cognition

This cognition layer has just been initialized and does not yet contain reliable project knowledge.

If you are an agent helping in this workspace, bootstrap cognition through CogGit tools instead of writing arbitrary files:

- use `coggit_snapshot` with `scope="untracked"` to find source paths that do not yet have cognition;
- use `coggit_add` for the selected source path so the paired cognition file is created from the correct template;
- read the handbook resource returned by `coggit_add`, then replace template placeholders with design intent, contracts, boundaries, and invariants;
- prefer a small useful starting set based on the user's current focus, recent edits, or an important folder/layer skeleton;
- verify the result with `coggit_status`.

Do not treat this README as project cognition. It is only a bootstrap marker.
