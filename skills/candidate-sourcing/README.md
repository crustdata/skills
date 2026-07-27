# Candidate Sourcing

Go from "I need to hire for role X" to Gmail drafts ready to send — powered by [Crustdata](https://crustdata.com)'s real-time people data APIs. An end-to-end AI recruiting workflow for founders who want to own hiring without paying $20K per placement to a recruiter or $100+/month for Juicebox.

## What it does

Give it a role description and it handles the entire pipeline:

1. **Finds candidates** matching your specific criteria via Crustdata's 1B+ person database and web search
2. **Verifies LinkedIn profiles** — never guesses URLs, always confirms through Crustdata (guessed URLs caused 12 errors in a real 91-person campaign)
3. **Finds email addresses** — business emails via Crustdata enrichment API, personal emails via Crustdata web search
4. **Writes personalized outreach** — each email references the candidate's specific work (papers, repos, projects), not generic job-title flattery
5. **Creates Gmail drafts** — ready for you to review and click send

## Example

**Input:**
> "Find 5 ML engineers who've published on retrieval-augmented generation. Prioritize people at startups, not FAANG. Draft outreach for our Founding ML Engineer role at [your company]."

**Output:**

| Candidate | Company | Why them | Email | Status |
|-----------|---------|----------|-------|--------|
| Jane Chen | Cohere | First author on RAG benchmarking paper (ACL 2024) | jane@cohere.com | Draft ready |
| Raj Patel | Pinecone | Built open-source RAG evaluation toolkit (2.3K GitHub stars) | raj@gmail.com | Draft ready |
| Maria Lopez | Weaviate | Led vector search team, speaks at MLOps conferences | maria@weaviate.io | Draft ready |
| ... | ... | ... | ... | ... |

Each Gmail draft has a personalized opener referencing their specific work — not "your experience as an ML Engineer demonstrates..."

## Why not Juicebox, HireEZ, or a recruiter?

| | Recruiter | Juicebox / HireEZ | This skill |
|---|---|---|---|
| **Cost** | $15-30K per hire (15-25% of salary) | $79-199/month per seat | Pay-per-use via Crustdata API |
| **Ranking** | Recruiter's judgment (variable) | Black-box AI — surfaces the same "obvious" candidates everyone else is targeting | You define the criteria — proof of work, hunger signals, relevance to your problems |
| **Outreach** | Generic templates or recruiter writes | Template-based sequences | Each email references specific work the candidate has done |
| **Control** | Low — recruiter runs the process | Medium — you search but AI ranks | Full — you see every step, review every draft before sending |
| **Risk** | LinkedIn account bans from tools | [Reported LinkedIn suspensions](https://thedailyhire.com/tools/juicebox-ai-recruiting-review) from browser extensions | No scraping, no LinkedIn violations |

## Use cases

- **Seed/Series A founders** sourcing their first 5-10 engineers without a recruiter
- **Hiring managers** who want to own top-of-funnel instead of waiting for recruiters to deliver
- **Technical founders** who know exactly what "good" looks like and want to define their own ranking criteria
- **Anyone tired of Juicebox** surfacing the same senior FAANG engineers that every other startup is pitching

## How it works (under the hood)

The skill runs 5 phases in sequence:

1. **Define & search** — extracts role criteria, searches Crustdata people database + arXiv/GitHub/web for candidates matching your specific technical problems
2. **Verify LinkedIn** — waterfall lookup: Crustdata people DB → Crustdata web search → mark unverified. Never fabricates URLs
3. **Find emails** — Crustdata people enrichment (batch 25 at a time) for business emails, Crustdata web search for personal emails
4. **Write outreach** — personalized openers based on each candidate's proof of work (papers, repos, projects), not job titles
5. **Create Gmail drafts + tracker** — drafts in your Gmail, CSV tracker logging every candidate and their status

## Setup

**Claude.ai (web) or Claude Desktop (macOS/Windows):**
1. Go to Settings → Connectors → "Add custom connector" → paste `https://mcp.crustdata.com/mcp` → click "Add" ([step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
2. Find Gmail in your Connectors list → click "Connect"
3. Download the [`.skill` file](https://github.com/crustdata/skills/releases) and upload it to your project
4. Tell Claude: "I need to hire a [role]. Find candidates and set up outreach."

**Claude Code (CLI):**
1. Add the [Crustdata MCP server](https://mcp.crustdata.com/mcp) and Gmail MCP server to your config
2. Import this skill directory into your workspace
3. Tell Claude: "I need to hire a [role]. Find candidates and set up outreach."

## Evals

12 test cases derived from real production errors in a 91-candidate outreach campaign. Covers LinkedIn URL verification, email extraction, outreach quality, and pipeline correctness. Battle-tested against actual failure modes — not synthetic examples.

See [`evals/evals.json`](./evals/evals.json).
