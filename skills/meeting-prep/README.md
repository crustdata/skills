# Meeting Prep

Score today's inbound and walk into today's calls knowing something real. Powered by [Crustdata](https://crustdata.com)'s live data on 200M+ companies and 800M+ people.

## What it does

Three modes, all built for the two minutes you actually have:

1. **Inbound triage** — paste a form fill, an email, or a whole day's leads. Get a score, a verdict, and the reasons, with every signal dated. Batch mode ranks the day in one table
2. **Pre-call brief** — one screen per meeting: what the company is doing right now, who you're meeting, three talking points, one opener, two discovery questions, and the objection you're going to hear
3. **Call plan** — a discovery question plan of 8-12 open questions mapped to your qualification framework, or a demo flow built only from pains the prospect actually said out loud

Nothing is invented. If there's no recent news, it says so instead of writing a fake hook.

## Example

**Input:**
> "Score this inbound: jordan@northwind.example, Jordan Lee, 'Director of Data Platform', filled out the pricing form. We sell data-quality tooling to engineering teams at US software companies, 200-2000 people."

**Output:**

| | |
|---|---|
| **Company** | Northwind Systems — software, resolved from the email domain. 840 people, +26% headcount in 12 months |
| **Fit** | 3/3 — US, software, inside the size band |
| **Title** | 2/2 — Director of Data Platform is a named buyer title |
| **Timing** | 2/2 — $85M Series C on 2026-03-11; 34 open engineering roles, 9 of them data engineering |
| **Verdict** | 🔥 **Route now** — 7/7, no disqualifiers |
| **Why now** | Data hiring is outpacing the rest of the company, and a platform director filling out a pricing form is a build-vs-buy decision already in motion |

Ask for a brief on the same lead and you get the other side of it:

> **Opener:** "Saw you're nine data hires deep since the Series C — is the platform team catching pipeline breaks before the finance team does, or after?"
>
> **Likely objection:** "We built our own checks." **Pre-empt:** ask what happens when the person who wrote them is on vacation.

## How it works

1. **Resolves the lead or account** against Crustdata's company database — free identity resolution, so a whole day's inbound is resolved before a single credit is spent, and anything unresolvable is flagged rather than dropped
2. **Pulls the signals that matter**: Crustdata's company enrichment (size, growth, funding, news), job postings API (what they're hiring for, which is what they're about to buy), people enrichment (career, tenure, background), and social post API (what they're saying right now)
3. **Scores or writes** — a transparent rubric with the evidence and its date on every row, or a one-screen brief. Every claim traces to a source

Got a CRM, call recorder, or email connected? It reads them for past context with the same account, read-only. It never writes, logs, or sends anything.

## Works well with

- **icp-builder** — define your ICP once; this skill scores against it automatically
- **account-research** — take a hot inbound into a full account plan
- **sales-prospecting** — find more companies like the good ones
- **sales-outreach** — turn the brief's dated opener into the actual email, call script, or sequence
- **warm-path-workspace** — find out who you already know there

All optional. With no config present, the skill asks two quick questions and runs.

## Setup

### Claude.ai (web) or Claude Desktop (macOS/Windows)

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Ask Claude: "Prep my call with [company]" or paste an inbound lead and say "is this worth my time?"

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Ask: `/meeting-prep prep my 2pm with acme.com`

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `company_identify` | Resolves domains and names to company records | Free |
| `company_autocomplete` / `person_autocomplete` | Resolves industries, titles, and seniority bands to valid filter values | Free |
| `account_credits` | Reports your credit balance on demand | Free |
| `company_search` | Firmographics for a whole batch of leads in one call | ~0.03 cr/result |
| `company_enrich` | Size, growth, funding, and news for one account | 2 cr/match |
| `person_search` | Filters people by title, seniority band, or employer | ~0.03 cr/result |
| `person_enrich` | Career, tenure, education for the person you're meeting | 1 cr |
| `job_search` | Open roles — the clearest read on what a company is about to buy | ~0.03 cr/result; counts near-free |
| `social_post_list_live` | What they're actually talking about | 1 cr/post (capped) |
| `web_search_live` | Last-60-days news the enrich missed | 1 cr/query |
| `person_contact_enrich` | Emails and phones (opt-in, cost-confirmed first) | Up to 5 cr/person |

A triage batch of 10 leads costs under 1 credit. A full pre-call brief is about 8-10.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover single-lead scoring, batch triage with a hard disqualifier, a pre-call brief with a grounded opener, a discovery plan mapped to a qualification framework, and a demo request with thin discovery.

See [SKILL.md](./SKILL.md) for the full methodology.
