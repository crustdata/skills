# Crustdata Skills

Open-source [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills) and [Claude Cowork](https://claude.ai) skills powered by [Crustdata](https://crustdata.com)'s real-time B2B data APIs. Each skill is a ready-to-use AI workflow for sales, recruiting, and growth tasks — no coding required.

## Skills

| Skill | What it does |
|-------|-------------|
| [Email Enrichment](./email-enrichment/) | Turn a list of names into verified business and personal emails |

*More skills coming soon.*

---

## Getting started

Every skill in this repo works with both **Claude Cowork** (web) and **Claude Code** (CLI). Setup is the same for all skills:

### Claude Cowork (web — no coding required)

1. **Get a Crustdata API key** at [crustdata.com](https://crustdata.com)
2. **Add the Crustdata integration** — in your Cowork project settings, add the MCP server: `https://mcp.crustdata.com/mcp`
3. **Upload a skill** — download the `.skill` file from [Releases](https://github.com/crustdata/skills/releases) and upload it to your Cowork project

### Claude Code (CLI)

**1. Add the Crustdata MCP server** to your config:

```json
{
  "mcpServers": {
    "crustdata": {
      "url": "https://mcp.crustdata.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Get your API key at [crustdata.com](https://crustdata.com).

**2. Clone this repo:**

```bash
git clone https://github.com/crustdata/skills.git
```

---

## Email Enrichment

> Bulk email finder for B2B contact enrichment. Find business emails and personal emails from a list of names, LinkedIn profiles, or a spreadsheet.

**Input:** A list of people — names, companies, LinkedIn URLs, or an .xlsx/.csv spreadsheet

**Output:** Verified business emails + personal emails, added as new columns

### Before & After

```
BEFORE:                                    AFTER:
┌──────────────┬─────────────┐             ┌──────────────┬─────────────┬─────────────────────┬──────────────────────┐
│ Name         │ Company     │             │ Name         │ Company     │ Business Email      │ Personal Email       │
├──────────────┼─────────────┤             ├──────────────┼─────────────┼─────────────────────┼──────────────────────┤
│ Pete Koomen  │ YC          │    ──►      │ Pete Koomen  │ YC          │ pete@ycombinator.com│ koomen@gmail.com     │
│ Kaushik Iska │ ClickHouse  │             │ Kaushik Iska │ ClickHouse  │ kaushik@clickhouse… │ iska.kaushik@gmail…  │
│ Topher Conway│ SV Angel    │             │ Topher Conway│ SV Angel    │ topher@svangel.com  │ —                    │
└──────────────┴─────────────┘             └──────────────┴─────────────┴─────────────────────┴──────────────────────┘
```

### How it works

1. **Resolves identities** — matches names + companies to LinkedIn profiles via Crustdata's 1B+ person database
2. **Finds business emails** — enriches profiles in batches using Crustdata's people enrichment API
3. **Finds personal emails** — uses Crustdata's web search API with smart multi-source discovery

### Use cases

- **Sales prospecting** — enrich lead lists with verified business emails for cold outreach
- **Recruiting** — find personal emails for engineering candidates you want to reach directly
- **Investor outreach** — build contact lists for fundraising from conference attendee lists
- **Event follow-up** — turn a spreadsheet of people you met into actionable contacts

### Try it

Just ask Claude: *"Find emails for these people: [paste your list]"*

[Full documentation and evals →](./email-enrichment/)

---

## Contributing

Each skill lives in its own directory:

```
skills/
  email-enrichment/
    SKILL.md          # Skill definition (the AI reads this)
    README.md         # Human-readable docs
    evals/
      evals.json      # Test cases for benchmarking
```

## License

MIT — see [LICENSE](./LICENSE).

---

Built on [Crustdata](https://crustdata.com) — the public data layer for AI and humans.
