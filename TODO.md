# TODO

## 2026-09-14 - real eval `coggit-intent-status` fails: model calls `any_nav` first, then wanders through pwsh until timeout

**Evidence (spotted from the dsh-extra side, 2026-09-13/14)**: host dsh 0.1.5-rc.2 (fb2c4b9e), `@catheadowl/dsh-eval@0.3.0` (post-migration), profile `coggit-headless`. Three-part failure:

- `first tool is: 'coggit_status'`: expected first `'coggit_status'`; first was `'any_nav'`;
- `tool called: 'coggit_status'`: full tool sequence `[any_nav, pwsh x6, skill, pwsh x2, read, pwsh x2, read, pwsh, read, pwsh]` — `coggit_status` never appears again;
- `run timed out` (exit 1).

Every other real case in the same batch passed and the mock suite is 4/4 green — **unrelated to the eval framework 0.3.0 changes**. Artifacts: `adapters/dsh/eval/behavior/real/.runs/coggit-intent-status/` (note: from eval's next minor, `.runs` is wiped before each write — collect evidence before re-running).

**Investigation directions (by suspicion)**:

1. Tool-selection face: does `any_nav`'s description over-match "status / where is" style intents and steal the first call — compare both tools' descriptions and the system-prompt tool list under 0.1.5-rc.2;
2. Case task wording: does it leave ambiguity for the word "status";
3. After the wrong first tool, the pwsh self-justification loop hits the timeout ceiling (case `timeoutMs` / CLI default 180s) — is the ceiling too tight for that path.

**Note**: reproducing costs real model calls — `$DSH_HOME/.credentials.yaml` is present on this machine, so real mode genuinely runs (credential gate: env `DEEPSEEK_API_KEY` OR the credentials file, either one counts).
