---
description: Sign in to Crustdata — opens the browser; runs off the main thread (no chatter)
disable-model-invocation: true
context: fork
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs" --detach`
