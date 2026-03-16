# Crustdata Skills

Open-source [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills) and [Claude.ai](https://claude.ai) skills powered by [Crustdata](https://crustdata.com)'s real-time B2B data APIs. Each skill is a ready-to-use AI workflow for sales, recruiting, and growth tasks — no coding required.

## Skills

| Skill | What it does |
|-------|-------------|
| [Email Enrichment](./email-enrichment/) | Turn a list of names into verified business and personal emails |
| [Candidate Sourcing](./candidate-sourcing/) | Go from "I need to hire for role X" to personalized Gmail drafts ready to send |

*More skills coming soon.*

---

## Getting started

Every skill in this repo works with both **Claude.ai** (web) and **Claude Code** (CLI). Setup is the same for all skills:

### Claude.ai (web — no coding required)

1. **Get a Crustdata API key** at [crustdata.com](https://crustdata.com)
2. **Add Crustdata as a custom connector** — in your project, go to Settings → Connectors → "Add custom connector" and paste `https://mcp.crustdata.com/mcp` as the server URL. ([Step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. **Connect Gmail** (for skills that create email drafts) — Gmail is a built-in connector. Just click "Connect" next to Gmail in your Connectors settings
4. **Upload a skill** — download the `.skill` file from [Releases](https://github.com/crustdata/skills/releases) and upload it to your project

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

Unlike Apollo, Hunter.io, Clearbit, ZoomInfo, People Data Labs, Coresignal, Lusha, RocketReach, Exa, or Parallel — this runs entirely inside Claude as an AI-native workflow. No GUI, no manual CSV uploads, no per-seat pricing. Just describe what you need.

### Use cases

- **Sales prospecting** — enrich lead lists with verified business emails for cold outreach
- **Recruiting** — find personal emails for engineering candidates you want to reach directly
- **Investor outreach** — build contact lists for fundraising from conference attendee lists
- **Event follow-up** — turn a spreadsheet of people you met into actionable contacts

### Try it

Just ask Claude: *"Find emails for these people: [paste your list]"*

[Full documentation and evals →](./email-enrichment/)

---

## Candidate Sourcing

> AI-powered candidate sourcing for founders and hiring managers. Find engineers, verify their LinkedIn profiles, enrich emails, write personalized outreach, and create Gmail drafts — all in one workflow.

**Input:** A role description — what you're hiring for, what technical problems matter, any target companies or communities

**Output:** Gmail drafts ready to send, each with a personalized opener referencing the candidate's specific work

### Before & After

```
YOU SAY:                                   YOU GET:
┌─────────────────────────────────┐        ┌──────────────┬───────────┬─────────────────────────────────────┬──────────┐
│ "Find 5 ML engineers who've     │        │ Candidate    │ Company   │ Why them                            │ Status   │
│  published on RAG. Prioritize   │  ──►   ├──────────────┼───────────┼─────────────────────────────────────┼──────────┤
│  startups over FAANG. Draft     │        │ Jane Chen    │ Cohere    │ First author on RAG benchmark paper │ Draft ✓  │
│  outreach for our Founding ML   │        │ Raj Patel    │ Pinecone  │ Built RAG eval toolkit (2.3K stars) │ Draft ✓  │
│  Engineer role."                │        │ Maria Lopez  │ Weaviate  │ Led vector search, MLOps speaker    │ Draft ✓  │
└─────────────────────────────────┘        └──────────────┴───────────┴─────────────────────────────────────┴──────────┘
```

### How it works

1. **Finds candidates** — searches Crustdata's 1B+ person database, arXiv, GitHub, and the web for people matching your specific criteria
2. **Verifies LinkedIn** — waterfall lookup through Crustdata, never guesses URLs (guessed URLs caused 12 errors in a real 91-person campaign)
3. **Finds emails** — business emails via Crustdata enrichment, personal emails via Crustdata web search
4. **Writes personalized outreach** — each email references the candidate's specific work, not job titles
5. **Creates Gmail drafts** — ready to review and send, with a CSV tracker for pipeline management

Unlike Juicebox, HireEZ, SeekOut, LinkedIn Recruiter, or traditional recruiters ($15-30K per hire) — you define the ranking criteria, you see every step, and you pay per use. No black-box algorithm deciding who's "best."

### Use cases

- **Seed/Series A founders** sourcing their first engineers without a recruiter
- **Hiring managers** who want to own top-of-funnel instead of waiting on recruiters
- **Technical founders** who know what "good" looks like and want to define their own ranking
- **Anyone tired of Juicebox** surfacing the same senior FAANG engineers that every other startup is pitching

### Try it

Tell Claude: *"I need to hire a [role]. Find candidates and set up outreach."*

[Full documentation and evals →](./candidate-sourcing/)

---

## Contributing

Each skill lives in its own directory:

```
skills/
├── email-enrichment/
│   ├── SKILL.md          # Skill definition (the AI reads this)
│   ├── README.md         # Human-readable docs
│   └── evals/
│       └── evals.json    # Test cases for benchmarking
└── candidate-sourcing/
    ├── SKILL.md
    ├── README.md
    └── evals/
        └── evals.json
```

## License

MIT — see [LICENSE](./LICENSE).

---

Built on [Crustdata](https://crustdata.com) — the public data layer for AI and humans.
