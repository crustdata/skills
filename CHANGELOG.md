# Changelog

All notable changes to this plugin will be documented here.

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
