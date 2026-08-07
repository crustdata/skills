# ICP Builder

Paste one LinkedIn URL — get your persona profile, inferred ICP, and writing voice, saved as config files your other GTM skills read. Powered by [Crustdata](https://crustdata.com)'s real-time people and company data.

## What it does

Give it your LinkedIn URL and it builds your GTM setup:

- **Who you are** — name, title, company, tenure, background from your profile
- **What you sell** — product and category from your company's data
- **Your inferred ICP** — industries, headcount, geography, funding stage, buyer titles. Labeled *inferred* and shown back to you for correction before anything is saved
- **Your writing voice** — tone and style derived from your actual posts, not a questionnaire
- **Two config files** — `config/persona-profile.md` and `config/gtm-config.md`, which the [sales-prospecting](../sales-prospecting) and [account-research](../account-research) skills read at startup

No interview. It never asks "what do you sell" or "who's your ICP" — the URL answers that.

## Quick start

Connect the [Crustdata custom connector](https://install.crustdata.com/mcp), then ask:

> "Set me up — here's my LinkedIn: linkedin.com/in/yourname"

## Example

**Input:**
> "Build my ICP. My LinkedIn is linkedin.com/in/janedoe"

**Output:**

| Config section | What gets written |
|---|---|
| Identity | Jane Doe — VP Sales at Acme Analytics (since 2023) |
| What we sell | Product analytics for consumer mobile teams |
| Inferred ICP | Consumer mobile companies, 51-500 employees, Series A+; buyers: VP Product, Head of Growth — labeled *inferred*, you correct it |
| Voice | Direct, short sentences, first-person; derived from her last 10 posts |
| Topics | Activation benchmarks, onboarding experiments |
| Stack | CRM: connected; Sequencer: none (draft-only mode) |

Then: "Here's who I think you are — correct me if I'm off." You fix anything wrong, and both config files are written.

## How it works

1. **Optional stack question** — name your CRM, sequencer, and other tools, or skip everything. Skipped tools are recorded as draft-only: you get drafts and CSV exports instead of pushes into the tool
2. **One-URL enrichment** — Crustdata's person enrichment (profile and work history), company enrichment (what your company is and does), and social post APIs (your voice and topics) turn the URL into a persona. The ICP is derived from what your company sells and who typically buys it, labeled *inferred*, and shown back for correction
3. **Config written** — `config/persona-profile.md` and `config/gtm-config.md` land in your working directory; sales-prospecting, account-research, sales-outreach, and meeting-prep pick them up automatically

No Crustdata connection, or a thin profile? It takes 2-3 lines from you instead (name and role, what the company does, who you sell to) and writes the same files. It never runs a long interview.

## Setup

### Claude.ai (web) or Claude Desktop (macOS/Windows)

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Ask: "Set me up — here's my LinkedIn: [your URL]"

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Import this skill directory into your workspace
3. Ask: "Set me up — here's my LinkedIn: [your URL]"

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `person_enrich` | Profile + work history for your URL | 1 cr |
| `company_identify` | Resolves your company when needed | Free |
| `company_enrich` | What your company is and does | 2 cr |
| `social_post_list_live` | Your recent posts, for voice and topics | 1 cr/post (capped at 10) |
| `company_autocomplete` / `person_autocomplete` | Filter-ready ICP values | Free |

A typical full run costs about 13 credits.

## Works with

- [sales-prospecting](../sales-prospecting) — builds lists from the ICP this skill writes
- [account-research](../account-research) — researches accounts with your persona as context

Both read `config/gtm-config.md` and `config/persona-profile.md` at startup and point back here when the config is missing.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover the one-URL happy path, the no-connection fallback, refreshing an existing config, and skipping the stack question entirely.

See [SKILL.md](./SKILL.md) for the full methodology.
