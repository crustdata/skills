---
name: b2b-research
description: Research companies and people with the Crustdata MCP server — plan the cheapest correct tool path, compose one execute script, and keep credit spend visible. Use when asked to find, enrich, or compare companies, people, jobs, or social posts using Crustdata.
---

# B2B research with Crustdata

The Crustdata MCP server runs in Code Mode: you see three meta-tools —
`list_tools`, `get_schema`, and `execute` — and reach the ~21 data tools by
writing a short script for `execute` that calls `callTool(name, params)`.
Every run self-reports the exact credits it spent.

## Method

1. **Discover before you compose.** Call `list_tools` once per session, and
   `get_schema` for each tool you are about to use — it shows the filterable
   columns, the response shape, and steering notes (filter/response aliases,
   value formats, sortable columns). Never guess a field name.
2. **Free probes first.** These cost nothing and prevent wasted paid calls:
   - `company_identify` — resolve a name/domain/URL to a company id.
   - `describe_scope` — which filter columns your plan actually permits
     (avoids a 403 after a paid call).
   - `company_autocomplete` / `person_autocomplete` — valid filter values.
3. **One script, narrow result.** Compose the whole ask (search → filter →
   enrich) in a single `execute` script. Branch on `r.ok` after every
   `callTool` — a failed call does not abort the script, and unchecked
   failures look like "no results". Return only the fields the user needs;
   intermediate data should stay server-side.
4. **Cheapest correct path.** Prefer the cached dataset (`company_search`,
   `person_search`, `job_search`) and only use the `*_live` variants when the
   user needs real-time data — live tools are slower and rate-limited.
   Enrichment is additive: ask only for the contact add-ons you need.
5. **Report spend.** Surface the credits the run reported alongside the answer
   whenever the user cares about cost or the run was non-trivial.

## Recipes

- **Research a company:** `company_identify` (free) → `company_enrich` for
  headcount/funding/technologies → `social_post_list_live` for recent activity
  signals, all in one `execute`.
- **Find decision-makers:** `person_search` filtered by company + seniority +
  title → enrich only the top matches for business emails.
- **Hiring intelligence:** `job_search` by company/role/location; compare
  across competitors in one script rather than one call per company.
- **Reverse lookup:** `person_enrich` takes a LinkedIn URL or business email
  directly — no search needed.

## When something fails

| Symptom | Do this |
|---------|---------|
| Permission error on a field | Call `describe_scope`, use a permitted column |
| Person/company not found | Try the `*_live` variant or broaden filters |
| Rate limit on a live tool | Wait and retry, or switch to the cached variant |
| Insufficient credits | Tell the user to top up at app.crustdata.com |
| Timeout on a broad query | Tighten filters or lower the limit |
