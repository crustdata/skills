# Email Enrichment

Turn email addresses into rich contact profiles, or find verified emails for any list of people. Powered by [Crustdata](https://crustdata.com)'s 800M+ profile database and real-time enrichment APIs.

## What it does

**Email to person** - Give it a list of email addresses and get back: name, title, company, profile URL, and company details. Works across work emails, .edu emails, and personal emails (gmail, yahoo, etc.).

**Person to email** - Give it a list of names (with companies or profile URLs) and get back: verified business emails, personal emails, and phone numbers.

## Quick start

Connect the [Crustdata MCP server](https://mcp.crustdata.com/mcp), then ask:

> "Here's a CSV of 500 emails from our calendar events. Can you tell me who these people are?"

or:

> "Find business emails for these 10 investors."

## How email-to-person enrichment works

The skill runs a 5-phase waterfall. Each phase catches what earlier phases missed:

```
Phase 1: Identify company from email domain        (free, ~85% of work domains)
Phase 2: Direct person lookup by email              (~60% of work+edu emails)
Phase 3: Search by name + company                   (+7% more matches)
Phase 4: Search by email pattern + verification     (+11% more matches)
Phase 5: Search by name for personal emails         (+1% more matches)
```

**Results on a mixed email list:**

| Email type | Person match rate | Company match rate |
|------------|------------------:|-------------------:|
| Work emails | 95%+ | 95%+ |
| .edu emails | 95%+ | 95%+ |
| Personal emails | 95%+ | N/A |

Every match in Phases 3-5 is verified: the name extracted from the email must appear in the returned profile, and for work/edu emails, the company or institution must appear in the person's employment or education history. This prevents false positives.

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
| bert.zacharin@gmail.com | - | - | unmatched |

## Setup

### Claude.ai or Claude Desktop

1. Go to **Settings > Connectors > Add custom connector**
2. Paste `https://mcp.crustdata.com/mcp` and click **Add** ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. Upload a CSV or paste your email list and ask Claude to enrich it

### Claude Code (CLI)

1. Add the Crustdata MCP server: `claude mcp add crustdata https://mcp.crustdata.com/mcp`
2. Ask Claude to enrich your emails: `/email-enrichment my_emails.csv`

## Crustdata MCP tools used

| Tool | What it does | Cost |
|------|-------------|------|
| `crustdata_company_identify` | Resolves an email domain to a company | Free |
| `crustdata_people_enrich` | Looks up a person by their work/edu email | Credits |
| `crustdata_people_search_db` | Searches 800M+ profiles by name, company, or email patterns | Credits |
| `crustdata_web_search` | Web search fallback for hard-to-find contacts | Credits |

## Rate limits

The skill respects Crustdata's leaky bucket rate limits (15-60 RPM depending on endpoint). For large lists, it saves progress to a JSON file so it can resume if interrupted.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json) cover both directions: email-to-person (5-phase waterfall with work, edu, and personal emails) and person-to-email (profile resolution and business email enrichment).

See [SKILL.md](./SKILL.md) for the full technical methodology.
