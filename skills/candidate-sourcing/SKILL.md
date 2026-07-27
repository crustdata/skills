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

Use the company and role details to research what makes this company compelling to candidates — check their website, recent funding, product launches, or press mentions via `crustdata_web_search`. This research informs the company blurb in Phase 4.

### Search by technical output, not job title

Three signals matter more than years of experience or company prestige:

**Proof of work** — papers they authored, tools/repos they built with real usage, blog posts with technical depth, open-source contributions, demos or benchmarks they released.

**Hunger** — technical opinions posted publicly, Medium/Substack articles, conference talks, being cited by others, active GitHub beyond just commits.

**Relevance** — their specific work maps to the actual problems in the role, not just adjacent domains.

### Search sources and patterns

**Crustdata `people_search_db`** for structured search:
```json
{
  "params": {
    "filters": {
      "op": "and",
      "conditions": [
        {"column": "current_employers.title", "type": "(.)","value": "ML Engineer"},
        {"column": "current_employers.name", "type": "[.]", "value": "Company Name"}
      ]
    },
    "limit": 20
  }
}
```

**Research papers** — search arXiv, Google Scholar, Semantic Scholar for the core technical problem. Look at first/second authors, especially those not at top-5 labs.

**GitHub** — search repos by topic/keyword, look at meaningful contributors (not just maintainers).

**Crustdata web search** — `"[technical problem]" site:arxiv.org`, `"[name]" "[company]" github`, `"[community]" alumni engineer ML`.

### Output from Phase 1

A list of candidates, each with: full name, current role, current company, any school/community connection, and one specific piece of work that makes them relevant (paper, repo, tool, post). This "proof of work" note is critical — it becomes the basis for the outreach email opener in Phase 4.

---

## Phase 2: Verify LinkedIn URLs

**Never guess or construct LinkedIn URLs.** This is the single most common source of errors in outreach. Guessed URLs like `firstname-lastname` or `firstname-lastname-school` frequently 404 or point to the wrong person. Real LinkedIn slugs are auto-generated and look like `david-park-086833264` or `hongjunchoi92` — they are not predictable from a person's name.

### Waterfall approach

Use this exact priority order. Stop as soon as you get a confident match.

**Step 1: `crustdata_people_search_db`** (always try this first)

```json
{
  "params": {
    "filters": {
      "op": "and",
      "conditions": [
        {"column": "name", "type": "[.]", "value": "Person Name"},
        {"column": "current_employers.name", "type": "[.]", "value": "Company Name"}
      ]
    },
    "limit": 3
  }
}
```

Extract `flagship_profile_url` — this is the verified canonical LinkedIn URL.

**Tips:**
- Company names have variations ("Google DeepMind" vs "DeepMind" vs "Google") — try shorter names first, then variations
- If 0 results, try past employers or just the person's name with a broader filter
- If multiple results, match by headline, location, or education
- Run these in batches of 5-6 parallel calls for efficiency

**Step 2: `crustdata_web_search`** (fallback when Step 1 returns 0)

```json
{
  "params": {
    "query": "Person Name Company distinctive-keyword",
    "site": "linkedin.com",
    "limit": 5
  }
}
```

Verify the result matches by checking the snippet for employer/role alignment. Don't just grab the first LinkedIn URL.

**Step 3: Mark as unverified** (if both fail)

Keep whatever URL exists but add a note: "LinkedIn URL unverified." Never fabricate a URL.

### Slug comparison

When verifying an existing URL: extract the slug (part after `linkedin.com/in/`), strip trailing slashes, compare case-insensitively. Different slugs = wrong URL, use the `flagship_profile_url` instead.

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

Batch up to 25 LinkedIn URLs per call:
```
crustdata_people_enrich:
  linkedin_profile_url: "url1,url2,url3..."
  fields: "name,business_email"
```

The `fields: "name,business_email"` parameter is critical — the default response does NOT include business email.

**Expected hit rates:** ~70-80% for professionals at known companies, ~40-50% for independent operators, ~20-30% for people between roles.

### 3B: Personal email via Crustdata person enrichment

Crustdata's person enrich API can return personal email addresses directly. This is faster and more reliable than GitHub commit extraction, so **always try this before falling back to GitHub**.

Request personal emails by including `fields=personal_contact_info.personal_emails`:
```
crustdata_people_enrich:
  linkedin_profile_url: "url1,url2,url3..."
  fields: "personal_contact_info.personal_emails"
```

The response includes a `personal_contact_info` object with a `personal_emails` array containing the person's personal email addresses (Gmail, ProtonMail, etc.).

You can combine this with business email and phone numbers in a single call:
```
crustdata_people_enrich:
  linkedin_profile_url: "url1,url2,url3..."
  fields: "name,business_email,personal_contact_info.personal_emails,personal_contact_info.phone_numbers"
```

**Credit cost:** 2 credits per profile for `personal_contact_info.personal_emails`, 2 credits per profile for `personal_contact_info.phone_numbers` (on top of the base enrichment cost).

**Batch limit:** Up to 25 LinkedIn URLs per call, same as business email enrichment.

**Recommended approach:** Combine steps 3A and 3B into a single enrichment call by requesting both `business_email` and `personal_contact_info.personal_emails` fields together. This saves an API round-trip and gets both email types at once.

If personal email is found, prefer it over business email for cold outreach (higher response rate, less likely to be filtered by corporate spam). If this returns no personal email for a candidate, fall through to GitHub commit extraction below.

### 3C: Personal email via GitHub commit history (fallback if 3B returns nothing)

This is the most powerful technique for technical candidates. Git records the author's email in every commit, and this metadata is accessible even when profile email privacy is enabled.

**Step 1: Find GitHub username**
- Check Crustdata enrichment response (may include GitHub URL, but verify it's the right person)
- Web search: `"[Name] [Company] GitHub site:github.com"`
- Check their personal website or Twitter bio

**Step 2: Verify the GitHub profile belongs to this person**
Confirm at least 2 of: bio mentions known company/role, profile name matches, repo topics align with known expertise, web search confirms the connection.

**Step 3: Find oldest non-fork repo**
```
crustdata_web_fetch:
  urls: ["https://api.github.com/users/{username}/repos?sort=created&direction=asc&per_page=5"]
```
Pick first repo where `"fork": false`. Older repos (pre-2019) are more likely to have real emails.

**Step 4: Extract email from commits**

Method A — Commits API:
```
crustdata_web_fetch:
  urls: ["https://api.github.com/repos/{owner}/{repo}/commits?per_page=1"]
```
Look in `[0].commit.author.email`.

Method B — `.patch` endpoint (bypasses privacy settings):
```
crustdata_web_fetch:
  urls: ["https://github.com/{owner}/{repo}/commit/{sha}.patch"]
```
Extract from `From: Name <email>` header line.

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
- Use `.patch` endpoints (don't count against REST API limits)
- Fetch HTML commit pages and extract SHAs with regex, then use `.patch`
- Batch `crustdata_web_fetch` calls with multiple URLs (up to 10 per call)
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
2. **Batch LinkedIn verification** (Phase 2) — 5-6 parallel `people_search_db` calls; web search fallback for failures
3. **Batch email enrichment** (Phase 3A + 3B) — up to 25 LinkedIn URLs per call with `fields: "name,business_email,personal_contact_info.personal_emails"` to get both business and personal emails in one round-trip
4. **Triage for GitHub** (Phase 3C) — identify candidates still missing emails who are engineers likely to have GitHub profiles; prioritize them for commit email extraction
5. **Batch GitHub lookups** (Phase 3C) — `crustdata_web_fetch` with multiple GitHub URLs per call (up to 10)
6. **Web search fallbacks** (Phase 3D) — for candidates where Crustdata enrichment and GitHub both failed
7. **Write all email copy** (Phase 4) — draft all openers in one pass, using the proof-of-work notes from Phase 1
8. **Create all Gmail drafts** (Phase 5) — create drafts and log to tracker

### Handling large API responses

Crustdata enrichment and people_search_db calls can return results that exceed token limits and get saved to files. When this happens:

```python
import json
with open(filepath) as f:
    data = json.load(f)
inner = json.loads(data[0]['text'])
for p in inner.get('profiles', []):
    print(p.get('name'), '|', p.get('flagship_profile_url'))
```

Always parse saved results with Python rather than trying to process them inline.

---

## Tool dependencies

This skill requires:
- **Crustdata MCP server** ([mcp.crustdata.com/mcp](https://mcp.crustdata.com/mcp)): provides `crustdata_people_search_db`, `crustdata_people_enrich` (with `fields` supporting `business_email`, `personal_contact_info.personal_emails`, `personal_contact_info.phone_numbers`), `crustdata_company_enrich`, `crustdata_web_search`, `crustdata_web_fetch`
- **Gmail MCP**: `gmail_create_draft`
- **Python** (with `openpyxl` for spreadsheet I/O, `csv` for tracker)
- **Web search** (Crustdata) for fallback email discovery

---

## Founder exclusion rule

**Do not reach out to current founders, co-founders, CEOs, or CTOs** — people who are actively running their own company. They are unlikely to leave, and contacting them wastes a slot and can feel tone-deaf.

### How to detect founders

Check the candidate's current title during Phase 1. Flag anyone whose title contains: Founder, Co-Founder, Co-founder, CEO, CTO, or "Chief" with "Officer" (e.g., Chief Technology Officer).

### The shrinking-company exception

The only case where it's worth reaching out to a current founder is when their company is visibly failing. All three conditions must be true:

1. **Headcount is declining** — use `crustdata_company_enrich` with the company's domain:
   ```
   crustdata_company_enrich:
     company_domain: "example.com"
     fields: "company_name,headcount,web_traffic,founders"
   ```
   Check `headcount_latest.linkedin_headcount_total_growth_percent` — look for negative month-over-month and quarter-over-quarter growth.

2. **Website traffic is declining** — in the same enrichment response, check `web_traffic` for downward trends in monthly visitors.

3. **People are leaving faster than the company can sustain** — the number of ex-employees who left in the last 3 months is greater than the current headcount. This signals a company that's actively losing people, not just flat.

If all three conditions are met, the founder may be open to a new opportunity. If any condition is NOT met (e.g., the company is small but growing), skip the candidate and mark them as `status: "skipped"` in the tracker with a note like `"Excluded — active founder (company not shrinking)"`.

### Handling the enrichment response

Company enrichment responses can exceed token limits. Parse with Python:
```python
import json
with open(filepath) as f:
    data = json.load(f)
inner = json.loads(data[0]['text'])
companies = inner['companies']
for c in companies:
    hc = c.get('headcount_latest', c.get('headcount', {}))
    linkedin_hc = hc.get('linkedin_headcount', '?')
    growth = hc.get('linkedin_headcount_total_growth_percent', {})
    mom = growth.get('1_month', 0)
    qoq = growth.get('3_months', 0)
    print(f"{c['company_name']}: {linkedin_hc} employees, MoM: {mom}%, QoQ: {qoq}%")
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
