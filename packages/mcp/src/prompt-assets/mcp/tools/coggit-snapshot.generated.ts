// Generated from codebase/coggit_prompt. Do not edit by hand.

const toolSurface = {
  "title": "CogGit Snapshot",
  "description": "Discover and scope CogGit paired cognition trees. Large source trees are common, so MCP snapshot defaults to a shallow maxDepth=2 structural view. Call without scope for the normal tracked view. Select a node from the tree, then call coggit_status for that sourcePath before inspection, explanation, or editing. Use scope=\"untracked\" to inspect missing cognition, but do not proactively add untracked nodes; use coggit_add only when a node is clearly critical and worth formalizing now. Use scope=\"issues\" for maintenance. Use scope=\"all\" only for exhaustive diagnostics or debugging, not as the normal starting point."
} as const;

export default toolSurface;
