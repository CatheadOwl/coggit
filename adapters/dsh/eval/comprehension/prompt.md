You are a fresh, independent reviewer with NO prior knowledge of how these tools were designed. Below are three tools that a coding agent can call (their descriptions), and the exact output each tool returns in several scenarios — `coggit_status` returns plain text; `coggit_add` and `coggit_resolve` return JSON. Figure out, purely from what is shown, what every field and line means and how the agent is supposed to use the results.

{{EVAL_OBSERVATIONS}}

Answer in three parts, in this exact order:

**Part 1 — Per-field / per-line understanding.** Go through every field name (JSON tools) and every line or line-shape (status text: header lines, `Legend:`/`Actions:` blocks, issue rows, trailing hint lines) that appears across the scenarios, and state precisely what you believe each one means and when it is present vs omitted. Note especially anything you find confusing or whose meaning you are unsure about.

**Part 2 — Overall mental model.** Describe how you believe the three tools and their `surfaceHints` are meant to guide an agent's next action in each scenario. What does the agent DO after each output?

**Part 3 — Red flags.** List anything ambiguous, redundant, surprising, internally inconsistent, or easy to misinterpret, and why. Be concrete — quote the exact field or output line.

Do not invent a system you cannot see; reason only from the tool descriptions and the outputs. If something is genuinely ambiguous, say so explicitly rather than guessing confidently.
