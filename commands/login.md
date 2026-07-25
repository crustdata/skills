---
description: Sign in to Crustdata — browser OAuth; one login for the MCP tools and skill sync
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-auth.mjs" login`

The line above is the result of the sign-in that just ran (the browser handled it — you did
not run it). Relay it to the user in exactly ONE short line: on success confirm they're
logged in; on failure state the error and that they can re-run /crustdata:login or set
CRUSTDATA_API_KEY. Do not add anything else — no explanation, no next steps.
