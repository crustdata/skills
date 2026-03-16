# Crustdata Skills

**Turn a spreadsheet of names into verified business and personal emails** — and more. A collection of open-source [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) powered by [Crustdata](https://crustdata.com)'s real-time B2B data APIs.

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
2. **Finds business emails** — enriches profiles in batches of 25 using Crustdata's people enrichment API (70-80% hit rate for active professionals)
3. **Finds personal emails** — uses Crustdata's web search API with smart multi-source discovery to find personal contact information

Unlike traditional email finders (Apollo, Hunter.io, Clearbit), this runs entirely inside Claude Code as an AI-native workflow — no GUI, no manual CSV uploads, no per-seat pricing. Just describe what you need.

### Quick start

**1. Add the Crustdata MCP server to Claude Code**

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

**2. Import the skill**

Download `email-enrichment/` from this repo into your Claude Code skills directory, or clone the repo:

```bash
git clone https://github.com/crustdata/skills.git
```

**3. Use it**

Just ask Claude:

- *"Find emails for these people: [paste list]"*
- *"Enrich this spreadsheet with business and personal emails"* (attach .xlsx)
- *"Get me the email addresses for everyone in this investor list"*

### Use cases

- **Sales prospecting** — enrich lead lists with verified business emails for cold outreach
- **Recruiting** — find personal emails for engineering candidates you want to reach directly
- **Investor outreach** — build contact lists for fundraising from conference attendee lists
- **Event follow-up** — turn a spreadsheet of people you met into actionable contacts

---

## All Skills

| Skill | Description |
|-------|-------------|
| [email-enrichment](./email-enrichment/) | Bulk email finder — enrich contact lists with verified business and personal emails |

*More skills coming soon.*

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
