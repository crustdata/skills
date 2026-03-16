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

See [SKILL.md](./SKILL.md) for the full technical methodology.

## Setup

1. Install the [Crustdata MCP server](https://mcp.crustdata.com/mcp) in Claude Code
2. Import this skill into your Claude Code workspace
3. Ask Claude to "find emails for these people" with your list

## Evals

Test cases are in [`evals/evals.json`](./evals/evals.json). Run them with the Claude Code skill-creator eval framework to benchmark performance.
