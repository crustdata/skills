# Email Enrichment

Turn email addresses into rich contact profiles, or find verified emails for any list of people. Powered by [Crustdata](https://crustdata.com)'s 800M+ profile database and real-time enrichment APIs.

## What it does

**Email to person** - Give it a list of email addresses and get back: name, title, company, profile URL, and company details. Works across work emails, .edu emails, and personal emails (gmail, yahoo, outlook).

**Person to email** - Give it a list of names (with companies or profile URLs) and get back: verified business emails, personal emails, and phone numbers.

## Quick start

Connect the [Crustdata Code Mode MCP server](https://install.crustdata.com/mcp), then ask:

> "Here's a CSV of 500 emails from our calendar events. Can you tell me who these people are?"

or:

> "Find business emails for these 10 investors."

## How email-to-person enrichment works

The skill runs a six-phase waterfall. Each phase catches what earlier phases missed:

```
Phase 1: Identify company from email domain              (free)
Phase 2: Direct person lookup by email                    (work/edu sync, personal async)
Phase 3: Search by name + company                         (work/edu fallback)
Phase 4: Search by name for personal emails               (personal fallback)
Phase 5: Web search to find profile URL                   (all types fallback)
Phase 6: Multi-signal scoring gate                        (quality filter)
```

Phase 2 looks up work and edu emails directly via the `business_emails` identifier, and personal emails (gmail, yahoo, outlook) through an async batch identify job; anything still unmatched is resolved by name via Phases 4/5.

Every match is verified. Work and edu email results are checked against employer domains. Phases 3-5 results pass through a scoring gate that requires strong name and company alignment before accepting.

## Example

**Input:**
```
email
kayla@openai.com
dennis@rre.com
rkoning@hbs.edu
bert.zacharin@gmail.com
```

**Output:**
| email | person | company | method |
|-------|--------|---------|--------|
| kayla@openai.com | Kayla Wood | OpenAI | person_enrich |
| dennis@rre.com | Dennis Cherian | RRE Ventures | person_enrich |
| rkoning@hbs.edu | Rem Koning | Harvard Business School | person_enrich |
| bert.zacharin@gmail.com | Albert Zacharin | Coinbase | name_search |

## Setup

### Claude.ai or Claude Desktop

1. Go to **Customize > Connectors > Add custom connector**
2. Paste `https://install.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Upload a CSV or paste your email list and ask Claude to enrich it

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add --transport http crustdata https://install.crustdata.com/mcp`
2. Ask Claude to enrich your emails: `/email-enrichment my_emails.csv`

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `company_identify` | Resolves an email domain to a company | Free |
| `person_enrich` | Looks up a person by work email or profile URL, returns business/personal emails | ~1-7 cr (additive) |
| `person_search` | Searches 800M+ profiles by name and company | ~0.03 cr/result |
| `web_search_live` | Web search fallback for hard-to-find contacts | 1 cr/query |
| `web_enrich_live` | Fetches page content (e.g. GitHub commit patches) | 1 cr/page |
| `dev_platform_enrich` | GitHub/dev-platform profile lookup for technical people | +1 cr |

## Scaling

Rate limiting is handled by the host inside `execute`. For large lists, the skill batches enrich calls (up to 25 per call) and fans out independent work in parallel, saving progress to a JSON file so it can resume if interrupted.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover both directions: email-to-person (six-phase waterfall with work, edu, and personal emails) and person-to-email (profile resolution and business email enrichment).

See [SKILL.md](./SKILL.md) for the full technical methodology.
