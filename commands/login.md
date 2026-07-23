---
description: Sign in to Crustdata — opens the browser directly (no AI in the loop)
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs" --detach`

Opening your browser to sign in to Crustdata — finish the sign-in there and you're set. The
token is saved to `~/.crustdata/credentials.json` and used by both the MCP tools and the
skill sync. No browser (SSH / headless)? Run
`CRUSTDATA_LOGIN_NO_BROWSER=1 node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs"` and open the
printed URL, or set `CRUSTDATA_API_KEY`.
