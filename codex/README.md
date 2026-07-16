# Crustdata for Codex

The Codex build of the Crustdata plugin — a **self-contained** plugin package with the same three parts as the Claude plugin:

1. **MCP data tools** — the remote `install.crustdata.com/mcp` server (OAuth 2.1 / DCR), bundled via [`.mcp.json`](./.mcp.json).
2. **Bundled public skills** — `SKILL.md` workflows under [`skills/`](./skills) (the SKILL.md format is identical across Codex and Claude).
3. **Gated per-account skills** — a `SessionStart` hook ([`hooks/`](./hooks)) that syncs the signed-in user's entitled skills, using the vendored engine in [`core/`](./core).

Codex installs a plugin by copying **only** the plugin root into its cache, so everything the plugin needs lives inside `codex/` — `core/` and `skills/` are **vendored** here (see [Development](#development)), not referenced from the repo root.

## Install

```
codex plugin marketplace add crustdata/skills
codex plugin add crustdata@crustdata
codex mcp login crustdata                       # MCP tools auth (Codex-native OAuth/DCR)
node "$PLUGIN_ROOT/bin/crustdata-login.mjs"      # gated-skill hook auth (see note)
```

`CRUSTDATA_API_KEY` still works as an override for the hook (local / pre-OAuth).

## Layout

```
codex/
├── .codex-plugin/plugin.json   # manifest (skills / mcpServers / hooks / interface)
├── .mcp.json                   # remote MCP server, auth: oauth
├── hooks/hooks.json            # SessionStart → hooks/skills-sync.mjs
├── hooks/skills-sync.mjs       # imports ./core/{skill-sync,credential-store}
├── bin/crustdata-login.mjs     # imports ./core/oauth-login (runLogin)
├── core/                       # VENDORED from repo-root core/ (single source)
└── skills/                     # VENDORED from repo-root skills/ (single source)
```

## Two logins, on purpose

The **MCP tools** authenticate through Codex's own `codex mcp login` (Codex holds that token; a hook can't read it). The **gated-skill hook** therefore needs its own credential — `bin/crustdata-login.mjs` writes the shared `~/.crustdata` store the hook reads. If gated skills move to MCP-tool delivery (a backend change), this second login goes away.

## Development

`codex/core/` and `codex/skills/` are **generated** — do not edit them directly. Edit the single source at the repo root (`core/`, `skills/`), then re-vendor:

```
node scripts/build-codex-plugin.mjs
```

`tests/codex-vendor.test.mjs` fails if the vendored copies drift from the source.

## Verify against a live Codex before merge

Built to the current Codex docs (<https://learn.chatgpt.com/docs/build-plugins>); confirm against a real `codex` install:

1. **Marketplace surfaces the plugin** — `codex plugin marketplace add …` then `codex plugin list --available` lists `crustdata`, and `codex plugin add crustdata@crustdata` installs it.
2. **`.mcp.json` OAuth schema** — that `{"url","auth":"oauth"}` is the accepted remote-server shape (vs `bearer_token_env_var`), and `codex mcp login crustdata` completes DCR against `install.crustdata.com` (mcp2 implements DCR).
3. **`codex mcp login` trigger** — whether the plugin's `ON_INSTALL` policy prompts it, or it stays a one-time manual step.
4. **Gated-skill timing** — a skill the hook writes at `SessionStart` may only register on the next session (discovery is at startup); confirm and adjust the `additionalContext` note / consider `~/.agents/skills` as the write target if `PLUGIN_ROOT` is read-only.
