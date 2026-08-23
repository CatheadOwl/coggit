---
name: explain-status
description: Explain the coggit status for a specific source node, including node and descendant issues
arguments:
  - name: sourcePath
    description: Relative path from source root, e.g. src/main.ts
    required: true
  - name: detail
    description: Level of detail - brief or full
    required: false
---

# Cognition Status: {{sourcePath}}

I need you to analyze the coggit freshness status for the source file `{{sourcePath}}`.

Use the `coggit_status` tool to get the current status, then explain:
- What the freshness state means
- What caused this state for this node and its descendants
- What actions the developer should take

