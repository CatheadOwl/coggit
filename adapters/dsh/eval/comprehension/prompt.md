You are a fresh, independent reviewer with NO prior knowledge of how these tools were designed. Below are three tools that a coding agent can call (their descriptions), and the exact JSON each tool returns in several scenarios. Figure out, purely from what is shown, what every field means and how the agent is supposed to use the results.

{{EVAL_OBSERVATIONS}}

Answer in three parts, in this exact order:

**Part 1 — Per-field understanding.** Go through every field name that appears across the scenarios and state precisely what you believe each one means and when it is present vs omitted. Note especially any field you find confusing or whose meaning you are unsure about.

**Part 2 — Overall mental model.** Describe how you believe the three tools and their `surfaceHints` are meant to guide an agent's next action in each scenario. What does the agent DO after each output?

**Part 3 — Red flags.** List anything ambiguous, redundant, surprising, internally inconsistent, or easy to misinterpret, and why. Be concrete — quote the exact field or output line.

Do not invent a system you cannot see; reason only from the tool descriptions and the outputs. If something is genuinely ambiguous, say so explicitly rather than guessing confidently.
