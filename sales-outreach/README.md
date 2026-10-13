# Sales Outreach

> End-to-end B2B sales pipeline. Given a target ICP, find companies showing buying signals, identify the right decision-maker, enrich their email, and create personalized Gmail drafts — all in one workflow.

**Input:** A description of your ICP — target role, company stage, industry, and the problem your product solves

**Output:** Gmail drafts ready to review and send, each referencing a specific growth signal at that company, plus a CSV tracker

---

## Before & After

```
YOU SAY:                                        YOU GET:
┌──────────────────────────────────────┐        ┌──────────────────┬──────────────┬───────────────────────────┬──────────┐
│ "Find me 10 VP Engineering prospects │        │ Prospect         │ Company      │ Signal                    │ Status   │
│  at Series B SaaS companies. We help │  ──►   ├──────────────────┼──────────────┼───────────────────────────┼──────────┤
│  teams manage data pipelines at      │        │ Arjun Mehta      │ Pipebird     │ +38% headcount QoQ        │ Draft ✓  │
│  scale. Draft cold emails."          │        │ Sarah Lin        │ Sequin       │ Raised Series A last month│ Draft ✓  │
│                                      │        │ Ravi Sood        │ Airbyte      │ +22% web traffic MoM      │ Draft ✓  │
└──────────────────────────────────────┘        └──────────────────┴──────────────┴───────────────────────────┴──────────┘
```

---

## How it works

1. **Finds target companies** — searches Crustdata's company database for businesses matching your ICP, scored by growth signals (headcount growth, web traffic, recent funding)
2. **Identifies decision-makers** — finds the specific person who owns the pain your product solves, not just the CEO
3. **Verifies LinkedIn** — uses Crustdata's verified `flagship_profile_url`, never guesses slugs
4. **Finds emails** — business and personal emails via Crustdata enrichment, GitHub commit history as fallback
5. **Writes personalized openers** — each email references a specific signal at that company (e.g., "saw your headcount grew 40% QoQ"), not a generic template
6. **Creates Gmail drafts** — ready to review and send, with a CSV tracker for pipeline management

---

## What makes the emails different

Most cold email tools send the same template with `{{first_name}}` swapped in. This skill finds a *specific reason* to reach out to each company right now:

| Generic (bad) | Signal-based (good) |
|---|---|
| "Companies your size often struggle with data pipelines" | "Saw Pipebird grew 38% QoQ — that kind of growth tends to surface pipeline reliability issues fast" |
| "Congrats on your recent funding!" | "Noticed you raised Series A last month — usually when teams start buying the infra tooling they've been putting off" |
| "As VP Engineering, you're probably dealing with scaling challenges" | "Your web traffic is up 22% MoM — that's when query latency starts becoming a customer-facing problem" |

---

## Use cases

- **Founder-led sales** — reach the right person at the right company at the right time, without a sales team
- **SDR automation** — build top-of-funnel at scale without manual research
- **Account-based outreach** — target a specific list of named accounts with personalized signals
- **Post-funding outreach** — catch companies right after a raise when budgets open up
- **Expansion into new verticals** — test ICP hypotheses quickly by running targeted batches

---

## Try it

Tell Claude: *"Find me [N] prospects matching [ICP description]. We help [what you do]. Draft cold emails."*

Example:
> "Find 10 VP Engineering prospects at Series B SaaS companies with fast headcount growth. We help engineering teams manage data pipelines at scale. My name is Sarah, I'm Head of Sales at Rivela. Draft cold emails."

---

## Setup

**Required connectors:**

1. **Crustdata** — go to [Settings → Connectors](https://claude.ai/settings/connectors) → "Add custom connector" → paste `https://mcp.crustdata.com/mcp` → Add. ([Setup guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
2. **Gmail** — find Gmail in your Connectors list and click "Connect"

**Get a Crustdata API key** at [crustdata.com](https://crustdata.com)

---

## Skill structure

```
sales-outreach/
├── SKILL.md          # Skill definition (Claude reads this)
├── README.md         # This file
└── evals/
    └── evals.json    # Test cases for benchmarking
```
