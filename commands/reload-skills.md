---
description: Pull the latest Crustdata skills granted to your account, without restarting
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/crustdata-reload-skills.mjs"`

The line above is the result of the sync that just ran (it already ran — you did not run it).
Relay it to the user in exactly ONE short line. Do not add anything else: no explanation, no
next steps, no list of skills. If it says to start a new session, keep that part.
