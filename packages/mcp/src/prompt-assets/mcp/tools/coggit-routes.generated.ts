// Generated from codebase/coggit_prompt. Do not edit by hand.

const toolSurface = {
  "title": "CogGit Routes",
  "description": "Default route map for CogGit-tracked projects. Defaults to a flat route index: tree-ordered path lines with summaries and truncation markers. Set format=\"tree\" for a nested parent-child view. Route lines use source-root-relative paths; sourcePath also accepts paths that include the configured source root prefix. Use \".\" for the source root itself, and if a sourcePath filter misses the tool will surface close route path hints when available."
} as const;

export default toolSurface;
