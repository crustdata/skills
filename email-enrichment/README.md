# Email Enrichment

Find verified business and personal emails for any list of people — powered by [Crustdata](https://crustdata.com)'s real-time people enrichment and web search APIs.

## What it does

Give it a list of names (with optional LinkedIn URLs, companies, or titles) and it returns:

- **Business emails** via Crustdata's 1B+ profile enrichment API
- **Personal emails** via Crustdata's web search API and multi-source discovery

Works with spreadsheets (.xlsx/.csv) or plain text lists.

## Example

**Input:**
| Name | Company | Title |
|------|---------|-------|
| Pete Koomen | Y Combinator | General Partner |
| Kaushik Iska | ClickHouse | Engineer |
| Topher Conway | SV Angel | Managing Partner |

**Output:**
| Name | Company | Business Email | Personal Email |
|------|---------|---------------|----------------|
| Pete Koomen | Y Combinator | pete@ycombinator.com | koomen@gmail.com |
| Kaushik Iska | ClickHouse | kaushik@clickhouse.com | iska.kaushik@gmail.com |
| Topher Conway | SV Angel | topher@svangel.com | — |

## How it works

1. **Resolves LinkedIn profiles** — uses Crustdata people search to match names + companies to LinkedIn URLs
2. **Enriches business emails** — batches up to 25 profiles per API call via Crustdata's people enrichment API
3. **Finds personal emails** — uses Crustdata's web search API with smart multi-source discovery to find personal contact information

An AI-native alternative to Apollo, Hunter.io, Clearbit, ZoomInfo, People Data Labs, Coresignal, Lusha, RocketReach, Exa, and Parallel — runs entirely inside Claude with no GUI or per-seat pricing.

See [SKILL.md](./SKILL.md) for the full technical methodology.

## Setup

**Claude.ai (web) or Claude Desktop (macOS/Windows):**
1. Go to Settings → Connectors → "Add custom connector" → paste `https://mcp.crustdata.com/mcp` → click "Add" ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
2. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
3. Ask Claude to "find emails for these people" with your list

**Claude Code (CLI):**
1. Add the [Crustdata MCP server](https://mcp.crustdata.com/mcp) to your Claude Code config
2. Import this skill directory into your workspace
3. Ask Claude to "find emails for these people" with your list

## Evals

Test cases are in [`evals/evals.json`](./evals/evals.json). Run them with the Claude Code skill-creator eval framework to benchmark performance.
