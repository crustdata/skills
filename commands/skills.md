---
description: Your Crustdata skills — list what is installed and available, sync now, get one onto this machine, or drop one you pulled
argument-hint: "[sync | get <slug> | drop <slug>]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/crustdata-skills.mjs" "$ARGUMENTS"`

The line above is the result of the command that just ran (it already ran — you did not run it).
Relay it to the user in exactly ONE short line. Do not add anything else: no explanation, no
next steps. If it names a setup step or says to start a new session, keep that part.
