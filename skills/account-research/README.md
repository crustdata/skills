# Account Research

Know a company completely before you sell to it: a full account plan, an org chart, their tech stack, or a battlecard against a competitor. Powered by [Crustdata](https://crustdata.com)'s real-time company and people data.

## What it does

Four research modes, one ask each:

- **Account deep-dive & plan** — firmographics, headcount growth, funding, last-90-days news, open roles, what the company is posting about, and who runs the function you sell to. If your CRM, call recorder, team chat, or email are connected, it also sweeps your own history with the account (read-only) and folds it into the plan.
- **Org chart** — who runs the company and who reports to whom, rendered as a standalone HTML chart with photos, names, clean titles, and LinkedIn links.
- **Tech stack & wedge** — what tools they run today, a confidence tag on each item, and the single best opening for what you sell.
- **Competitive battlecard** — a competitor's real strengths, their gaps, discovery questions that expose those gaps, and responses to the objections you'll hear.

Works standalone: if you haven't defined your ICP yet, it asks two quick questions and gets on with it (or use the **icp-builder** skill to set up a reusable config).

## Example

**Input:**
> "Account plan for acme.com — we sell a data-quality platform to engineering teams."

**Output (excerpt):**

| Section | Sample from the plan |
|---|---|
| One-line read | Acme is a 412-person cloud data-integration platform scaling into enterprise after its March Series C — the stage where pipeline data quality breaks first |
| Signals | Headcount +18% in 12 months · $85M Series C (Mar 2026) · 34 open engineering roles, 9 mentioning "data pipeline" — every claim with a source link |
| Why we win | 9 pipeline-heavy job posts plus a public incident postmortem, and no data-quality tooling named anywhere: growing surface, no owner |
| Who to talk to | Priya Raman, VP Data Platform (champion hypothesis) · Marcus Webb, CTO (economic buyer) — with LinkedIn profiles |
| Our history | Two 2025 email threads with their platform team; a stalled-eval note in the CRM (pulled from your connected tools, if any) |
| Entry play + risks | Open with the postmortem angle via Priya; risk: their observability vendor is expanding into quality checks |
| Next steps | Aug 7: intro note to Priya · Aug 14: postmortem teardown follow-up · Sep 4: exec brief for Marcus |

## How it works

1. **Reads your context** — what you sell (from your config or two quick questions) and which internal sources are connected: CRM, call recorder, team chat, email. All internal sources are read-only.
2. **Sweeps Crustdata** — company enrichment, headcount and funding history, news, job postings, leadership search, recent company posts, and targeted web search — then merges in your team's own history with the account.
3. **Writes the deliverable** — account plan, org chart, stack map, or battlecard, with a source on every fact and inferences labeled as inferences.

## Setup

### Claude.ai (web) or Claude Desktop (macOS/Windows)

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Optional: connect your CRM, call recorder, team chat, or email from the Connectors list so account plans include your own history with the account
5. Ask: "Account plan for acme.com"

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Ask: "Research this account: acme.com" or "Org chart for acme.com"

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `company_identify` | Resolves a domain or name to a company | Free |
| `company_enrich` | Firmographics, headcount growth, funding, news | 2 cr/match |
| `person_search` | Leadership snapshots and org-chart people pulls | ~0.03 cr/result |
| `job_search` | Open roles, hiring focus, tech-stack signals | ~0.03 cr/result |
| `social_post_list_live` | The company's recent posts | 1 cr/post |
| `web_search_live` | Last-90-days news sweep | 1 cr/query |
| `web_enrich_live` | Reads specific pages (docs, blogs, leadership pages) | 1 cr/page |
| `company_autocomplete` / `person_autocomplete` | Resolve exact filter values | Free |

## Related skills

- **sales-prospecting** — find lookalikes of an account you just researched
- **icp-builder** — define what you sell and who buys it; this skill reads that config automatically

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover the account deep-dive, tech-stack detection, the org chart pipeline, and battlecard freshness rules.

See [SKILL.md](./SKILL.md) for the full methodology.
