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
codex mcp login crustdata            # the MCP data tools (Codex-native OAuth/DCR)
```

That's the MCP tools and the bundled public skills. **Gated per-account skills** need two more one-time steps.

## Enable gated skills

**1. Trust the SessionStart hook.** Codex does **not** auto-run a plugin's hooks — the first time, it prompts you to review and trust this plugin's `SessionStart` hook. Approve it. Until you do, gated sync won't run (the MCP tools and bundled skills work regardless).

**2. Sign in for the hook.** The hook reads a Crustdata token from the shared `~/.crustdata` store. Either:
- set **`CRUSTDATA_API_KEY`** in your environment (simplest), or
- run the login command **the hook prints** — when you're not signed in it logs `node "<resolved path>/bin/crustdata-login.mjs"` with the real cache path filled in; run that. (Don't type `$PLUGIN_ROOT/…` yourself — `PLUGIN_ROOT` is set only for hooks, not your shell.)

The MCP tools use Codex's own `codex mcp login` (Codex holds that token; a hook can't read it), which is why the gated-skill hook needs its own credential. If gated skills move to MCP-tool delivery (a backend change), this second login goes away.

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

## Development

`codex/core/` and `codex/skills/` are **generated** — do not edit them directly. Edit the single source at the repo root (`core/`, `skills/`), then re-vendor (this also refreshes the Claude plugin's copies):

```
node scripts/build-plugins.mjs
```

`tests/vendor.test.mjs` fails if any plugin's vendored copies drift from the source.

## Live-verified

A temp `codex plugin marketplace add` + `codex plugin add crustdata@crustdata` install works: the marketplace surfaces the plugin, the cache holds real `core/` + `skills/` + `hooks/` + `bin/` + `.mcp.json` + `.codex-plugin/plugin.json`, and the installed hook imports cleanly and no-ops when not signed in.

Still to confirm against a live session:
- **`.mcp.json` OAuth schema** — that `{"url","auth":"oauth"}` is the accepted remote-server shape (vs `bearer_token_env_var`), and `codex mcp login crustdata` completes DCR against `install.crustdata.com` (mcp2 implements DCR).
- **Gated-skill timing** — a skill the hook writes at `SessionStart` may only register on the next session (discovery is at startup); switch the write target to `~/.agents/skills` if `PLUGIN_ROOT` is read-only.
