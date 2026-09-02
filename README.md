# Crustdata Skills

Open-source skills for [Claude.ai](https://claude.ai), [Claude Desktop](https://claude.ai/download), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills), powered by [Crustdata](https://crustdata.com)'s real-time B2B data APIs. Each skill is a ready-to-use AI workflow for sales, recruiting, and growth tasks. No coding required.

## Skills

| Skill | What it does |
|-------|-------------|
| [Email Enrichment](./skills/email-enrichment/) | Find verified emails for a list of people, or identify the person behind an email |
| [Candidate Sourcing](./skills/candidate-sourcing/) | Find engineers for an open role and draft the outreach to each one |
| [Sales Prospecting](./skills/sales-prospecting/) | Build a list of companies worth selling to, and rank the ones you already have |
| [Account Research](./skills/account-research/) | Learn how a company works before you call it: who runs it, what they run on |
| [ICP Builder](./skills/icp-builder/) | Turn one LinkedIn URL into the customer profile every other skill reads |
| [Warm-Path Deal Workspace](./skills/warm-path-workspace/) | See who decides at an account, and who on your team can introduce you |
| [Meeting Prep](./skills/meeting-prep/) | Walk into today's calls knowing who you're talking to |
| [Sales Outreach](./skills/sales-outreach/) | Write the cold email, opening on something the person actually did |

*More skills coming soon.*

---

## Getting started

Install the plugin. It carries the Crustdata connector (800M+ profiles, 200M+ companies) and every skill in the table above, so there is nothing else to set up.

### Claude.ai, Claude Desktop, or Cowork

1. Open **Customize** in the left sidebar, then the **Plugins** tab
2. Click **Add**, then **Add marketplace**
3. Enter the repository `crustdata/skills`
4. Install the **Crustdata** plugin ([step-by-step guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude))

### Claude Code

```bash
claude plugin marketplace add crustdata/skills
claude plugin install crustdata@crustdata-plugin
```

The plugin is pure Node with no native dependencies, and runs the same on macOS, Linux, Windows, and WSL. It needs Node 22 or newer on your `PATH`.

### Signing in

The first time Claude uses a Crustdata tool it asks you to connect. Your browser opens, you sign in, and Claude reuses that connection every session after. There's no API key to paste.

### Just the data, without the skills

Inside Claude, add Crustdata as a connector instead: **Customize > Connectors > Add custom connector**, then paste `https://install.crustdata.com/mcp`.

The same endpoint works from your own code, for agent frameworks and backend jobs where a browser sign-in isn't practical. Point any MCP client at it and pass your API key as a bearer token:

```json
{
  "mcpServers": {
    "crustdata": {
      "type": "streamable-http",
      "url": "https://install.crustdata.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

Full reference in the [MCP docs](https://docs.crustdata.com/for-agents/mcp).

---

## Structure

```
.claude-plugin/   plugin and marketplace manifests
.mcp.json         the Crustdata connector
skills/           one folder per skill above
hooks/            session hook, syncs your skills at startup
tests/            plugin tests
```

## License

MIT. See [LICENSE](./LICENSE).

---

Built on [Crustdata](https://crustdata.com), the public data layer for AI and humans.
