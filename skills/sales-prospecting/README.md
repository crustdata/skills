# Sales Prospecting

One skill, seven prospecting playbooks: build target lists, rank your accounts, size your market, and get alerted when champions leave your customers. Powered by [Crustdata](https://crustdata.com)'s real-time data on 200M+ companies and 800M+ people.

## What it does

Tell it your goal and it routes to the right playbook:

1. **Find new companies** — a fresh target list from your ICP plus live buying signals
2. **Lookalikes** — companies that match your best customers' shared traits
3. **Rank my accounts** — paste a book, territory, or CSV; get back who to work first and why
4. **Event prospecting** — real sponsor/exhibitor rosters for a conference, ranked into a meet-list
5. **Expansion radar** — upsell openings inside existing customers: new funding, new execs, new teams, open roles
6. **TAM builder** — TAM/SAM/SOM from real company counts, not analyst guesses
7. **Champion tracker** — a list of champions who just left your customers, plus a weekly alert that keeps it running

Every list is scored FIT x TIMING x WARMTH, with the evidence and its date shown on each row. It works from free and low-cost data first and asks before spending credits on contact details.

## Example

**Input:**
> "Rank my accounts and tell me who to work first this week: stripe.com, ramp.com, brex.com, mercury.com, deel.com, gusto.com"

**Output:**

| Account | Why now | Score |
|---|---|---|
| Ramp | Fresh raise; fast recent headcount growth | 🔥 |
| Deel | Recent round; hiring surge across open roles | 🟡 |
| Mercury | Older funding; steady growth | 🟡 |
| Stripe | No recent funding signal; flat headcount | ⚪ |
| ... | ... | ... |

Plus a "top 5 this week" shortlist and, on request, the right people to contact at each hot account.

## How it works

1. **Resolves your inputs** — company names, domains, or a pasted CSV — against Crustdata's company database (free identity resolution; anything that can't be resolved is flagged, never silently dropped)
2. **Runs iterative filtered searches** across companies, people, and job postings, refining in rounds using real signals: funding recency, headcount growth, hiring surges, job changes
3. **Scores and ranks** with the evidence shown, then hands off — a spreadsheet, CSV export for your sequencer or CRM, or a deep-dive via the account-research skill

## Works well with

- **icp-builder** — define your ICP and personas once; this skill picks the config up automatically
- **account-research** — deep-dive any account this skill surfaces

Both are optional. With no config present, the skill just asks two quick questions and runs.

## Setup

### Claude.ai (web) or Claude Desktop (macOS/Windows)

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Ask Claude: "Build me a list of target companies" or "Rank my accounts" and paste your list

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Ask: `/sales-prospecting who should I prospect this week?`

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `company_identify` | Resolves names/domains to company records | Free |
| `company_autocomplete` / `person_autocomplete` | Resolves exact filter values | Free |
| `company_search` | Filtered company lists, market counts, lookalike traits | ~0.03 cr/result |
| `person_search` | Buyers, new hires, job-change tracking | ~0.03 cr/result |
| `job_search` | Open roles and hiring signals | ~0.03 cr/result; counts near-free |
| `web_search_live` | Event rosters, market-size cross-checks | 1 cr/query |
| `web_enrich_live` | Fetches sponsor/exhibitor pages | 1 cr/page |
| `social_post_search_live` | People posting about an event or topic | 1 cr/post |
| `person_contact_enrich` | Emails and phones (opt-in, cost-confirmed first) | Up to 5 cr/person |
| `company_enrich` | Deep company data (opt-in) | 2 cr/match; +2 if technographics returned |

Champion-tracker alerts use Crustdata's watcher API: the first run is a free baseline, then 0.5 credits per new champion found. The skill shows you the exact request and only creates the alert when you say yes.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover list building with iterative refinement, account ranking, market sizing with verifiable counts, champion tracking with alert setup, and running standalone with no saved config.

See [SKILL.md](./SKILL.md) for the full methodology.
