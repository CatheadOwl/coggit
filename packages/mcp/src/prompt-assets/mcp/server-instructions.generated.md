Read coggit://cognition-root before locating cognition files.
CogGit cognition records design intent, contracts, boundaries, and invariants, not implementation summaries.
CogGit cognition is a mirrored design layer over the source tree: once project roots are known, file cognition is the design counterpart of the same source-relative path without the trailing .md, and folder cognition is its README.md counterpart.
Before reading source code in a tracked project, use coggit_routes to find the relevant cognition document and inspect that cognition layer when it can inform the task.
CogGit MCP indexes the same cognition layer agents can grep/read directly: use its tools to narrow candidates, check freshness, and choose better sourcePath/file-search targets, while grep/read remains the primary way to inspect full cognition text.
CogGit cognition maintenance is source-scoped and suitable for subagents: delegate independent sourcePath updates with the relevant handbook resource.
Report contradictions between source, cognition, design intent, or the requested change before editing cognition; do not silently resolve uncertainty, and verify edited nodes with coggit_status.

