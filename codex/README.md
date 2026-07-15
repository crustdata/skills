# Crustdata for Codex

The Codex build of the Crustdata plugin — the same three parts as the Claude plugin, reusing the shared `../core` engine:

1. **MCP data tools** — the remote `install.crustdata.com/mcp` server (OAuth 2.1 / DCR), bundled via [`.mcp.json`](./.mcp.json).
2. **Bundled public skills** — `SKILL.md` workflows under [`skills/`](./skills) (a symlink to the repo-shared `../skills`; the SKILL.md format is identical across Codex and Claude).
3. **Gated per-account skills** — a `SessionStart` hook ([`hooks/`](./hooks)) that syncs the signed-in user's entitled skills, reusing `../core/skill-sync.mjs`.

## Install

```
codex plugin marketplace add crustdata/skills
codex plugin install crustdata
codex mcp login crustdata          # MCP tools auth (Codex-native OAuth/DCR)
node "$PLUGIN_ROOT/bin/crustdata-login.mjs"   # gated-skill hook auth (see note)
```

`CRUSTDATA_API_KEY` still works as an override for the hook (local/e2e or pre-OAuth).

## Layout

```
codex/
├── .codex-plugin/plugin.json   # manifest (skills / mcpServers / hooks)
├── .mcp.json                   # remote MCP server, auth: oauth
├── hooks/hooks.json            # SessionStart → hooks/skills-sync.mjs
├── hooks/skills-sync.mjs       # imports ../../core/{skill-sync,credential-store}
├── bin/crustdata-login.mjs     # imports ../../core/oauth-login (runLogin)
└── skills -> ../skills         # bundled public skills (shared)
```

The client-agnostic engine (`../core`) is shared with the Claude plugin — one source of truth for the OAuth flow, credential store, and sync logic.

## Two logins, on purpose

The **MCP tools** authenticate through Codex's own `codex mcp login` (Codex holds that token; a hook can't read it). The **gated-skill hook** therefore needs its own credential — `bin/crustdata-login.mjs` writes the shared `~/.crustdata` store that the hook reads. If gated skills move to MCP-tool delivery (a backend change), this second login goes away.

## Verify against a live Codex before merge

This is a scaffold built to the current Codex docs; confirm these against a real `codex` install (the analog of the Claude PR's "first real login"):

1. **`.mcp.json` OAuth schema** — that `{"url", "auth":"oauth"}` is the accepted remote-server shape (vs `bearer_token_env_var`), and that `codex mcp login crustdata` completes DCR against `install.crustdata.com` (mcp2 implements DCR, so it should).
2. **Shared `../core` on install** — `codex plugin marketplace add crustdata/skills` clones the full repo, so `hooks/skills-sync.mjs`'s `../../core/*` imports and the `skills` symlink resolve. If Codex copies only the `codex/` subdir into its cache, add a release step that vendors `core/` + `skills/` into the plugin (single source stays in the repo).
3. **`codex mcp login` trigger** — whether the plugin's install policy can prompt it, or it stays a one-time manual step.
4. **Gated-skill timing** — a skill the hook writes at `SessionStart` may only register on the next session (discovery is at startup); confirm and adjust the `additionalContext` note / consider `~/.agents/skills` as the write target if `PLUGIN_ROOT` is read-only.
