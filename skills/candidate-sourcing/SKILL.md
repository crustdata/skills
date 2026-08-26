---
name: candidate-sourcing
description: >
  End-to-end pipeline: find engineering candidates, verify LinkedIn URLs via Crustdata,
  find emails (Crustdata + GitHub commits), write personalized outreach, create Gmail drafts.
  Use when someone wants to go from "I need candidates for role X" to ready-to-send drafts.
  Trigger on: "source and email candidates", "find engineers and draft outreach", "build a
  candidate pipeline", "find people for [role] and set up emails", "automate candidate
  outreach", "run the full sourcing pipeline", or any variation where the goal is both
  finding candidates AND reaching out. Covers the entire loop — use individual skills
  (engineering-candidate-finder, contact-email-enricher, candidate-copy-drafter) only when
  the user wants just one part of the pipeline.
version: 0.1.0
display-name: Candidate Sourcing
category: recruiting
icon: user-search
summary: "Go from an open role to Gmail drafts, each one referencing the candidate's own work."
sample-prompts:
  - "Find 5 ML engineers who've published on retrieval-augmented generation and draft outreach to each"
  - "Source backend engineers in Berlin for our Series A team"
  - "Build a candidate pipeline for a founding designer role"
---

# Candidate Sourcing Pipeline

An end-to-end skill that takes a hiring role and produces ready-to-send Gmail drafts for
strong candidates — handling discovery, LinkedIn verification, email enrichment, personalized
copy, and draft creation in one continuous workflow.

The pipeline has five phases. Each phase feeds into the next, and the skill is designed to
run them in sequence with minimal human intervention. The user reviews the final Gmail
drafts and clicks send.

---

## Phase 1: Define the search and find candidates

### Clarify the role and company

Before searching, extract or confirm these details from the user. **Do not assume any of these — always ask if not provided:**

**About the hiring company (needed for outreach in Phase 4):**
- Company name
- What the company does (1-2 sentences)
- Stage/traction (e.g., "Series A, $10M raised" or "500-person public company")
- Location / remote policy
- The sender's name and title (for the email signature)

**About the role and ideal candidate:**
- The role title (e.g., "Founding ML Engineer")
- 2-3 core technical problems the role involves
- Target companies, research labs, or communities to search
- Any school/alumni connections to prioritize (e.g., "IIIT Hyderabad alumni")
- Location preferences or constraints
- How many candidates the user wants in this batch

**About the ideal candidate profile:**
- Seniority level (e.g., "3-7 years", "senior", "staff+")
- Must-have technical skills or domain expertise
- Nice-to-have signals (open source contributions, publications, specific frameworks)
- Any deal-breakers or filters (e.g., "no FAANG lifers", "must have startup experience")

Use the company and role details to research what makes this company compelling to candidates — check their website, recent funding, product launches, or press mentions via the Crustdata MCP's `web_search_live` tool. This research informs the company blurb in Phase 4.

### Search by technical output, not job title

Three signals matter more than years of experience or company prestige:

**Proof of work** — papers they authored, tools/repos they built with real usage, blog posts with technical depth, open-source contributions, demos or benchmarks they released.

**Hunger** — technical opinions posted publicly, Medium/Substack articles, conference talks, being cited by others, active GitHub beyond just commits.

**Relevance** — their specific work maps to the actual problems in the role, not just adjacent domains.

### Search sources and patterns

**Crustdata `person_search`** (via the Code Mode `execute` tool) for structured search:
```ts
// model query: find ML engineers at Company Name
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "experience.employment_details.current.title", type: "(.)", value: "ML Engineer" },
    { field: "experience.employment_details.current.company_name", type: "[.]", value: "Company Name" },
  ]},
  limit: 20,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => ({
  name: p.basic_profile?.name,
  title: p.basic_profile?.current_title,
  url: p.social_handles?.professional_network_identifier?.profile_url,
}));
```

**Research papers** — search arXiv, Google Scholar, Semantic Scholar for the core technical problem. Look at first/second authors, especially those not at top-5 labs.

**GitHub** — search repos by topic/keyword, look at meaningful contributors (not just maintainers).

**Crustdata web search** (`web_search_live`) — `"[technical problem]" site:arxiv.org`, `"[name]" "[company]" github`, `"[community]" alumni engineer ML`.

### Output from Phase 1

A list of candidates, each with: full name, current role, current company, any school/community connection, and one specific piece of work that makes them relevant (paper, repo, tool, post). This "proof of work" note is critical — it becomes the basis for the outreach email opener in Phase 4.

---

## Phase 2: Verify LinkedIn URLs

**Never guess or construct LinkedIn URLs.** This is the single most common source of errors in outreach. Guessed URLs like `firstname-lastname` or `firstname-lastname-school` frequently 404 or point to the wrong person. Real LinkedIn slugs are auto-generated and look like `david-park-086833264` or `hongjunchoi92` — they are not predictable from a person's name.

### Waterfall approach

Use this exact priority order. Stop as soon as you get a confident match.

**Step 1: `person_search`** (always try this first)

```ts
// model query: verify LinkedIn URL for Person Name at Company Name
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "[.]", value: "Person Name" },
    { field: "experience.employment_details.current.company_name", type: "[.]", value: "Company Name" },
  ]},
  limit: 3,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => ({
  name: p.basic_profile?.name,
  headline: p.basic_profile?.headline,
  url: p.social_handles?.professional_network_identifier?.profile_url,
}));
```

Extract `social_handles.professional_network_identifier.profile_url` — this is the verified canonical LinkedIn URL.

**Tips:**
- Company names have variations ("Google DeepMind" vs "DeepMind" vs "Google") — try shorter names first, then variations
- If 0 results, try past employers (`experience.employment_details.past.company_name`) or just the person's name with a broader filter
- If multiple results, match by headline, location, or education
- Run these as a single `execute` script that fans out independent lookups with `parallelMap` (batch the candidate list, then map) for efficiency

**Step 2: `web_search_live`** (fallback when Step 1 returns 0)

```ts
// model query: find LinkedIn profile for Person Name at Company
const r = await callTool("web_search_live", {
  query: "Person Name Company distinctive-keyword",
  site: "linkedin.com",
});
if (!r.ok) return { error: r.message };
return r.data.results;
```

Verify the result matches by checking the snippet for employer/role alignment. Don't just grab the first LinkedIn URL.

**Step 3: Mark as unverified** (if both fail)

Keep whatever URL exists but add a note: "LinkedIn URL unverified." Never fabricate a URL.

### Slug comparison

When verifying an existing URL: extract the slug (part after `linkedin.com/in/`), strip trailing slashes, compare case-insensitively. Different slugs = wrong URL, use the verified URL from `social_handles.professional_network_identifier.profile_url` instead.

### Real mistakes this prevents

These are actual errors from production outreach campaigns:

| Guessed slug | Actual slug | What happened |
|---|---|---|
| `david-park-princeton` | `david-park-086833264` | 404 — made-up slug |
| `vincent-chen-mit` | `vincent-chen-662a031b5` | 404 — school suffix doesn't work |
| `benoit-rostykus` | `benoitrostykus` | Wrong person — different profile |
| `hongjun-choi` | `hongjunchoi92` | Wrong person — different profile |
| `abhay-gupta-cmu` | `gupta-abhay` | Wrong person — completely different slug format |
| `benedict-arockiaraj` | `benedictflorance` | Wrong person — person uses a different name on LinkedIn |
| `initeshmethani` | `nitesh-methani-7554b3121` | Wrong person — typo in guessed slug |

### URL format

Always use `https://www.linkedin.com/in/{slug}` — never bare `linkedin.com/in/` without the protocol. Characters like `ü` need URL encoding (`%C3%BC`).

---

## Phase 3: Find email addresses

Every candidate needs an email address for the Gmail draft. Use this priority chain.

### 3A: Business email via Crustdata enrichment

Use `person_enrich` (via the Code Mode `execute` tool). It takes an array of LinkedIn URLs in `professional_network_profile_urls` (≤25 per call — `chunk(urls, 25)` then `parallelMap`), and field GROUPS (not leaf names) in `fields`. The `contact` group returns emails and phone numbers:

```ts
// model query: enrich business emails for a batch of candidate LinkedIn URLs
const urls = ["url1", "url2", "url3"]; // from Phase 2
const batches = chunk(urls, 25);
const results = await parallelMap(batches, async (batch) => {
  const r = await callTool("person_enrich", {
    professional_network_profile_urls: batch,
    fields: ["basic_profile", "contact"],
  });
  return r.ok ? r.data : [];
});
// each match: matches[0].person_data.contact.business_emails[].email
return results.flat();
```

The `contact` field group is critical — the default (`basic_profile` only) response does NOT include emails. Map each result back to its input URL via `matched_on`.

**Expected hit rates:** ~70-80% for professionals at known companies, ~40-50% for independent operators, ~20-30% for people between roles.

### 3B: Personal email via Crustdata contact enrichment

**For contact-only needs, prefer `person_contact_enrich` over `person_enrich` on cost.** `person_enrich` *can* return personal email (+2) and phone (+2) via its `contact` group, but it also bills a base profile charge (base 1 + contact tiers, cap 7). `person_contact_enrich` is the contact-only tool — it skips the base-profile charge (cap 5), so it's cheaper when you only want contact data. Try this before falling back to GitHub.

`person_contact_enrich` takes the same `professional_network_profile_urls` array (≤25 per call) and returns a `contact` object with `business_emails`, `personal_emails`, and `phone_numbers`. Pick tiers via dotted `fields`:
```ts
// model query: enrich personal emails + phone for candidate LinkedIn URLs
const r = await callTool("person_contact_enrich", {
  professional_network_profile_urls: chunk(urls, 25)[0],
  fields: ["contact.personal_emails", "contact.phone_numbers"],
});
if (!r.ok) return { error: r.message };
// per match: matches[0].person_data.contact.personal_emails[].email (objects), .phone_numbers[] (bare strings)
return r.data;
```

The response `person_data.contact` object has a `personal_emails` array of objects (`{ email, status }` — read `.email`, like `business_emails`; Gmail, ProtonMail, etc.) and a `phone_numbers` array of bare strings.

**Credit cost:** `person_contact_enrich` has no base charge and is priced per contact tier — roughly +1 business email, +2 personal email, +2 phone number, capped at 5 per profile. These per-tier numbers are a marginal/ceiling estimate, not a guaranteed cap: requesting a single dotted tier does NOT reliably limit the bill to that tier's increment — a `fields: ["contact.personal_emails"]` call has been observed billing the full 5-credit cap and returning all three tiers. It's still cheaper than `person_enrich` for contact data because it skips the base-profile charge, but don't assume one dotted field bounds the cost below the cap.

**Batch limit:** Up to 25 LinkedIn URLs per call.

**Recommended approach:** `person_contact_enrich` returns business, personal, and phone in one call — request the tiers you need together to save round-trips. `person_enrich` (Phase 3A) can also return all three contact tiers via its `contact` group, but it adds a base-profile charge, so prefer `person_contact_enrich` when you only need contact data.

If personal email is found, prefer it over business email for cold outreach (higher response rate, less likely to be filtered by corporate spam). If this returns no personal email for a candidate, fall through to GitHub commit extraction below.

### 3C: Personal email via GitHub commit history (fallback if 3B returns nothing)

This is the most powerful technique for technical candidates. Git records the author's email in every commit, and this metadata is accessible even when profile email privacy is enabled.

**Step 1: Find GitHub username**
- Native first: `person_enrich` with `social_handles` in `fields` returns a `dev_platform_identifier` (the GitHub handle), and adding `dev_platform_profiles` (the dev add-on, +1 credit) returns the full GitHub profile — repos, org memberships, and sometimes a public `email`. If that `email` is present and not a noreply address, use it and skip straight to Step 5
- `dev_platform_enrich({ crustdata_person_id })` fetches the same standalone for a person you already resolved
- Web search: `"[Name] [Company] GitHub site:github.com"`
- Check their personal website or Twitter bio

**Step 2: Verify the GitHub profile belongs to this person**
Confirm at least 2 of: bio mentions known company/role, profile name matches, repo topics align with known expertise, web search confirms the connection.

**Step 3: Find oldest non-fork repo**

If Step 1 ran a dev enrichment, its `dev_platform_profiles[].repos` entries already carry `full_name`, `is_fork`, and `github_created_at` — pick the oldest non-fork, no extra call needed. Otherwise list via the GitHub API:
```ts
// model query: list oldest repos for GitHub user {username}
const r = await callTool("web_enrich_live", {
  urls: ["https://api.github.com/users/{username}/repos?sort=created&direction=asc&per_page=5"],
});
if (!r.ok) return { error: r.message };
return r.data; // [{ success, url, title, content }]
```
Pick first repo where `"fork": false`. Older repos (pre-2019) are more likely to have real emails.

**Step 4: Extract email from commits**

Method A — Commits API:
```ts
// model query: read first commit of {owner}/{repo}
const r = await callTool("web_enrich_live", {
  urls: ["https://api.github.com/repos/{owner}/{repo}/commits?per_page=1"],
});
```
Look in `[0].commit.author.email` within the fetched `content`.

Method B — `.patch` endpoint (bypasses privacy settings):
```ts
// model query: read commit patch for {owner}/{repo}@{sha}
const r = await callTool("web_enrich_live", {
  urls: ["https://github.com/{owner}/{repo}/commit/{sha}.patch"],
});
```
Extract from `From: Name <email>` header line in the fetched `content`.

**Step 5: Validate** — discard `*@users.noreply.github.com`, `noreply@github.com`, and any email containing `noreply`.

### 3D: Web search fallbacks

When both Crustdata personal email enrichment and GitHub don't work, try these in order:
1. GitHub issues/READMEs: `"[name]" "@gmail.com" site:github.com`
2. Competitive programming: `"[name]" site:codeforces.com`
3. Personal websites: `"[name]" "[company]" email contact`
4. Conference speaker pages: `"[name]" "[company]" speaker email`
5. Academic profiles: `"[name]" site:scholar.google.com`

### 3E: Handle GitHub API rate limits

GitHub allows 60 unauthenticated requests/hour. Workarounds:
- Prefer the native dev enrichment for handle + repo discovery (Steps 1/3) — those calls never touch the GitHub REST API
- Use `.patch` endpoints (don't count against REST API limits)
- Fetch HTML commit pages and extract SHAs with regex, then use `.patch`
- Pass multiple URLs in a single `web_enrich_live` call (`urls: [...]`)
- Process in waves — API-dependent steps first, then non-API methods while rate limit resets

### Email priority

When you have multiple emails for a candidate, prefer in this order:
1. Personal Gmail/ProtonMail — highest response rate for cold outreach
2. University email — if they're still in academia
3. Business email — last resort for cold outreach (often filtered by corporate spam)

---

## Phase 4: Write personalized outreach emails

### The one rule that matters

**Praise specific work, not job titles or implied capabilities.**

"Leading applied science at Mistral means you know how to take ML from research to production" reads as "I saw your LinkedIn title and ran it through a template." Instead, find one thing they actually made and say something honest about it.

### Email structure

Every email follows this exact template:

```
Hi {first_name},

[1-sentence opener: say what impressed you — casual, no analysis]

[1-sentence pitch: role + company + location]

[3-line company blurb]

{sender_name},
{sender_title}
```

Short. No headers, no bullet points, no multi-paragraph explanations. Ask the user for their name, title, company name, and a 2-3 line company blurb if not already provided.

### Writing the opener

Use the "proof of work" note from Phase 1 — the specific paper, repo, tool, or post you identified during candidate discovery.

**Good opener patterns:**
- "Read your work on [specific paper/project] — [genuine reaction]."
- "Your [specific tool/repo] is [honest assessment with concrete detail]."
- "The path from [specific journey point A] to [B] is impressive."

**Bad opener patterns (never use these):**
- [their work] + [which is relevant because we also do X] — turns compliment into pitch
- [job title at company] + [therefore X skill] — title-based, not work-based
- [their research] + [is exactly the kind of thinking we need] — evaluates them for them
- Long parenthetical explanations — breaks casual flow

### The pitch line

> "We're hiring a [role] at [Company] in [location]. Would you be interested?"

Keep it direct. The opener already did the work.

### The company blurb

Ask the user for a 2-3 line company blurb if they haven't provided one. It should highlight traction, mission, and why now. Vary phrasing slightly across a batch to avoid identical emails.

### Subject line

Default: `"[Role] @ [Company]"`

---

## Phase 5: Create Gmail drafts and log to tracker

### Create Gmail drafts

For each candidate with a verified email, use `gmail_create_draft`:
- `to`: candidate's email address
- `subject`: the subject line
- `body`: the full email (opener + pitch + blurb + signature)

This is the terminal step. Gmail's MCP creates drafts but cannot send — the user reviews and clicks send manually.

### Log to the outreach tracker

After creating each draft, append a row to the role-specific CSV tracker:

```
/sessions/{session}/mnt/outputs/outreach_tracker_{role_slug}.csv
```

Where `role_slug` is lowercase-hyphenated (e.g., "Founding ML Engineer" → `founding_ml_engineer`).

CSV headers:
```
date,role_hiring_for,candidate_name,current_role,company,school_connection,linkedin_url,email,channel,subject,message_opener,status,notes,message_body
```

```python
import csv, datetime, os

tracker_path = "outreach_tracker_{role_slug}.csv"
fields = ["date","role_hiring_for","candidate_name","current_role","company",
          "school_connection","linkedin_url","email","channel","subject",
          "message_opener","status","notes","message_body"]

row = {
    "date": datetime.date.today().isoformat(),
    "role_hiring_for": "<role name>",
    "candidate_name": "<full name>",
    "current_role": "<title>",
    "company": "<company>",
    "school_connection": "<school or empty>",
    "linkedin_url": "<verified linkedin url>",
    "email": "<email address>",
    "channel": "email",
    "subject": "<subject line>",
    "message_opener": "<first sentence of email body>",
    "status": "drafted",
    "notes": "<email type + source: e.g. Personal Gmail via GitHub commit>",
    "message_body": "<full email body>"
}

file_exists = os.path.isfile(tracker_path)
with open(tracker_path, "a", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    if not file_exists:
        writer.writeheader()
    writer.writerow(row)
```

**Status values:** `drafted` (Gmail draft created), `sent` (user clicked send), `replied`, `no_contact` (no email found).

**Channel values:** `email`

### Candidates without email

If no email was found after the full enrichment chain, log them to the tracker with `status: "no_contact"` and a note explaining what was tried. The user can decide whether to pursue other channels manually.

---

## Batch workflow for efficiency

When processing many candidates (>5), use this sequence to minimize time:

1. **Search and collect candidates** (Phase 1) — build the full list first
2. **Batch LinkedIn verification** (Phase 2) — fan out `person_search` lookups with `parallelMap` in one `execute` script; web search (`web_search_live`) fallback for failures
3. **Batch email enrichment** (Phase 3A + 3B) — `person_enrich` (`fields: ["basic_profile", "contact"]`) for profile + business email, then `person_contact_enrich` (`fields: ["contact.personal_emails", "contact.phone_numbers"]`) for personal email + phone (cheaper for contact-only — skips the base-profile charge). Both batch up to 25 LinkedIn URLs per call (`chunk(urls, 25)` then `parallelMap`)
4. **Triage for GitHub** (Phase 3C) — identify candidates still missing emails who are engineers likely to have GitHub profiles; prioritize them for commit email extraction
5. **Batch GitHub lookups** (Phase 3C) — `web_enrich_live` with multiple GitHub URLs per call (`urls: [...]`)
6. **Web search fallbacks** (Phase 3D) — for candidates where Crustdata enrichment and GitHub both failed
7. **Write all email copy** (Phase 4) — draft all openers in one pass, using the proof-of-work notes from Phase 1
8. **Create all Gmail drafts** (Phase 5) — create drafts and log to tracker

### Handling large API responses

Crustdata enrichment and `person_search` calls can return large payloads. In Code Mode, shrink the response INSIDE the `execute` script before returning — only what you `return` reaches the model. Use `project`/`pick`/`compact` to keep just the fields you need, so the full payload never has to be re-parsed downstream:

```ts
// model query: search candidates and return a slim projection
const r = await callTool("person_search", { filters, limit: 25 });
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => ({
  name: p.basic_profile?.name,
  url: p.social_handles?.professional_network_identifier?.profile_url,
}));
```

Always reduce in-script (return IDs/URLs/emails, not whole profiles) rather than returning the raw response.

---

## Tool dependencies

This skill requires:
- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)): a single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All Crustdata data tools are reached inside an `execute({ code })` plain-JavaScript script via `await callTool(name, params)` — author against the TypeScript-typed surface from `get_schema`, but write no type annotations in the body. Tools used here: `person_search`, `person_enrich` (profile + business emails), `person_contact_enrich` (personal emails + phone numbers), `company_enrich`, `dev_platform_enrich` (GitHub profile + repos), `web_search_live`, `web_enrich_live`
- **Gmail MCP**: `gmail_create_draft`
- **Python** (with `openpyxl` for spreadsheet I/O, `csv` for tracker)
- **Web search** (Crustdata `web_search_live`) for fallback email discovery

---

## Founder exclusion rule

**Do not reach out to current founders, co-founders, CEOs, or CTOs** — people who are actively running their own company. They are unlikely to leave, and contacting them wastes a slot and can feel tone-deaf.

### How to detect founders

Check the candidate's current title during Phase 1. Flag anyone whose title contains: Founder, Co-Founder, Co-founder, CEO, CTO, or "Chief" with "Officer" (e.g., Chief Technology Officer).

### The shrinking-company exception

The only case where it's worth reaching out to a current founder is when their company is visibly failing. All three conditions must be true:

1. **Headcount is declining** — use `company_enrich` with the company's domain:
   ```ts
   // model query: check headcount trend for example.com
   const r = await callTool("company_enrich", {
     domains: ["example.com"],
     fields: ["basic_info", "headcount", "web_traffic"],
   });
   if (!r.ok) return { error: r.message };
   // per match: matches[0].company_data.headcount.{ total, growth_percent }
   return r.data;
   ```
   Check `headcount.growth_percent` (keys `mom`, `qoq`, `six_months`, `yoy`, `two_years`) — look for negative month-over-month (`mom`) and quarter-over-quarter (`qoq`) growth.

2. **Website traffic is declining** — check for downward trends in monthly visitors.

   > Read `web_traffic.domain_traffic` from `company_enrich` (request `fields: ["web_traffic"]`) for the monthly-visitor trend; the `seo` and `news` groups are available the same way.

3. **People are leaving faster than the company can sustain** — the number of ex-employees who left in the last 3 months is greater than the current headcount. This signals a company that's actively losing people, not just flat.

If all three conditions are met, the founder may be open to a new opportunity. If any condition is NOT met (e.g., the company is small but growing), skip the candidate and mark them as `status: "skipped"` in the tracker with a note like `"Excluded — active founder (company not shrinking)"`.

### Handling the enrichment response

`company_enrich` returns an array of `{ matched_on, match_type, matches: [{ confidence_score, company_data }] }`. Reduce it inside the `execute` script and return only the headcount signals you need:
```ts
// model query: project headcount growth signals for founder-company check
const r = await callTool("company_enrich", { domains: ["example.com"], fields: ["basic_info", "headcount"] });
if (!r.ok) return { error: r.message };
return r.data.map(m => {
  const cd = m.matches?.[0]?.company_data;
  const hc = cd?.headcount ?? {};
  const g = hc.growth_percent ?? {};
  return { name: cd?.basic_info?.name, total: hc.total, mom: g.mom ?? 0, qoq: g.qoq ?? 0 };
});
```

### Real examples

| Candidate | Company | What happened |
|---|---|---|
| Di Jin (Co-Founder) | Eigen AI (12 employees, -7.7% MoM) | Slightly declining but not enough ex-employees leaving → skipped |
| Sai Surbehera (Co-Founder/CTO) | Lapis Labs (5 employees, +25% MoM) | Company growing → skipped |
| Aayush Anand (Co-Founder) | Level.game (9 employees, stable) | Company active → skipped |

---

## What NOT to do

- **Never guess LinkedIn URLs** — always verify through Crustdata. Guessed URLs caused 12 errors in a single 91-person campaign.
- **Never send emails** — Gmail MCP creates drafts only. The user reviews and sends manually.
- **Never use title-based openers** — always reference specific work the candidate has done.
- **Never skip email validation** — discard noreply addresses, verify GitHub profiles belong to the right person.
- **Never write the same opener twice** — each candidate gets a unique opener based on their specific work.
- **Never reach out to active founders** — skip current founders/co-founders/CEOs/CTOs unless their company is visibly failing (declining headcount, declining traffic, and people leaving faster than the company can sustain). See "Founder exclusion rule" section above.
