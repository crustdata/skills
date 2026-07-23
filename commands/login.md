---
description: Sign in to Crustdata — opens the browser directly (no AI in the loop)
allowed-tools: Bash(nohup:*), Bash(node:*)
---

!`nohup node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs" </dev/null >/tmp/crustdata-login.log 2>&1 &`

Opening your browser to sign in to Crustdata — finish the sign-in there and you're set. The
token is saved to `~/.crustdata/credentials.json` and used by both the MCP tools and the
skill sync. If no browser opened, check `/tmp/crustdata-login.log`, or run
`CRUSTDATA_LOGIN_NO_BROWSER=1 node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs"`, or set
`CRUSTDATA_API_KEY`.
