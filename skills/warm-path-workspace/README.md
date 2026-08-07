# Warm-Path Deal Workspace

Point it at a target account and your team's LinkedIn connection exports — get back one shareable workspace showing who decides and who you already know who can get you to them. Powered by [Crustdata](https://crustdata.com)'s real-time company and people data.

## What it does

Builds a single self-contained HTML workspace per account:

- **Account brief** — what they do, scale, funding, hiring shape, what's changing and why now
- **Buying group** — 6-8 stakeholders grouped by deal role, each with a researched dossier: priorities, talking points, likely objections, and a grounded opener mined from their actual posts, every claim behind an evidence dropdown
- **Relationship map** — every route from your team's connections through real named intermediaries to the decision makers, scored and ranked by how short and strong each route is (an intern and a VP are not the same door)
- **Signals and plays** — hiring surges, job changes, funding, intent posts, turned into 3-6 prioritized moves that name the connection, the intermediary, and the decision maker

It reads LinkedIn connection exports (`Connections.csv` or the full data-export zip) from one or more teammates, detects each file's owner automatically, and verifies matches against live data before presenting them as routes — stale exports and false "we worked together" ties are checked, not assumed.

## Example

**Input:**
> "Find the warmest path into Acme — here are my and Priya's LinkedIn exports."

**Output (excerpt from the ranked chain list):**

| Route | Strength |
|---|---|
| Priya → Dana Fox (VP Platform Eng, former colleague at Initech 2021-2023, dates verified) → Sam Ortiz, CTO | Strong |
| You → Chris Lee (Director of Ops) → Ops leadership → Jordan Kim, VP Procurement | Medium |
| You → junior analyst, different function | Weak — flagged, not dressed up |

Plus the workspace itself: stakeholder dossiers with copy-ready openers, live signals, and the plays that spend your team's intro-favors only on routes that will land.

## How it works

1. **Researches the account** — Crustdata company enrichment, job postings, decision-maker data, and recent posts build the brief and the buying group
2. **Maps your network onto it** — parses the connection exports locally, matches them to the account (including acquired sub-brands), verifies employment and shared-history claims against Crustdata live data, and scores every route
3. **Publishes the workspace** — one interactive HTML artifact your whole team can open, with evidence behind every claim

## Setup

### Claude.ai (web) or Claude Desktop (macOS/Windows)

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Ask: "Who do we know at Acme?" and attach your LinkedIn connections export

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Ask: "Map our warm intros into acme.com" with your export files in the working directory

To get a LinkedIn connections export: LinkedIn > Settings > Data privacy > Get a copy of your data > Connections.

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `company_identify` | Resolves the account | Free |
| `company_enrich` | Brief: firmographics, funding, decision makers, news | 2 cr/match |
| `person_search` | Buying-group discovery, named intermediaries | ~0.03 cr/result |
| `person_enrich` | Stakeholder profiles, bench verification | 1 cr/profile |
| `social_post_list_live` | Stakeholder and company posts | 1 cr/post |
| `person_contact_enrich` | Emails and phones for stakeholders | Up to 5 cr/person |
| `job_search` | Hiring shape and notable roles | ~0.03 cr/result |
| `web_search_live` | Acquisition and alias research | 1 cr/query |

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json).

See [SKILL.md](./SKILL.md) for the full methodology.
