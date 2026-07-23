---
description: Sign in to Crustdata — one browser OAuth for the MCP tools and private-skill sync
allowed-tools: Bash(node:*)
---

Sign this machine in to Crustdata. One OAuth covers **both** the Crustdata MCP tools
and the private-skill sync — they share `~/.crustdata/credentials.json`.

Run the plugin's login script with the Bash tool and stream its stderr back to me:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs"
```

It opens a browser for a one-time sign-in (no key to paste), captures the OAuth callback
on a loopback port, and saves the token. When it finishes, tell me whether sign-in
succeeded (it prints a masked token tail) — never echo the full token.

No local browser (SSH / headless / a cloud session)? The loopback redirect can't reach
you — run `CRUSTDATA_LOGIN_NO_BROWSER=1 node "${CLAUDE_PLUGIN_ROOT}/bin/crustdata-login.mjs"`
and open the printed URL instead, or set `CRUSTDATA_API_KEY` in the environment.
