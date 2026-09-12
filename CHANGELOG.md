# Changelog

All notable changes to this plugin will be documented here.

## 1.5.0

- `/crustdata:skills` lists what is installed on this machine and what else your account can have.
- `/crustdata:reload-skills` is now `/crustdata:skills sync`, so the skill commands live in one place.

## 1.4.0

- `/crustdata:reload-skills`: the mid-session sync for Claude Desktop, which has no built-in
  `/reload-skills`. Prints one line, worst first, and says when a new session is needed.
- Command files declare `allowed-tools`, without which Claude Code aborted the command before it
  ran and reported success. `/crustdata:login` had never run in a published version because of
  this; CI now fails a command file that omits it.
- The hook and the commands resolve the credential and plugin root through one shared module, so
  a command syncs as the same caller as the hook beside it.

## 1.3.0

- `/crustdata:login` for skill sync: the browser sign-in (or an API key pasted on the same page)
  stores a token in `~/.crustdata/credentials.json`, which the SessionStart hook reads when
  `CRUSTDATA_API_KEY` is not set. Claude only; Grok keeps the env var, and the MCP tools stay on
  the client's own OAuth.

## 0.6.0

- Cursor installs from this bundle. `.cursor-plugin/plugin.json` and `.cursor-mcp.json`
  ship alongside the Claude and Codex manifests, so one repo now serves all three clients
  and the separate Cursor plugin repo is retired.
- Every vendor manifest is generated from `plugin.meta.json`, so identity and version
  cannot drift between clients.

## 0.5.2

- Added `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`, making the
  bundle installable from Codex and submittable to the OpenAI plugin directory.

## Cursor plugin 1.0.0 (initial release, previously versioned separately)

- Added the `crustdata` MCP server backed by Crustdata's hosted MCP (`https://install.crustdata.com/mcp`).
- Auth uses OAuth via Crustdata sign-in. No API key to configure.
- Added `crustdata-tool-selection` rule: how to drive the Code Mode server (`list_tools` / `get_schema` / `execute`) and which tool to reach for, cheapest correct path first.
- Bundled Crustdata's public skills catalog (the skills published at crustdata/skills).
