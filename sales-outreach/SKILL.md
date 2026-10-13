---
name: sales-outreach
description: >
  End-to-end B2B sales pipeline: find companies matching a target ICP using growth signals,
  identify the right decision-maker, enrich their email, write a personalized cold email
  referencing a specific company signal, and create a Gmail draft. Use when someone wants
  to go from "I want to reach VP Engineering at Series B SaaS companies" to ready-to-send
  Gmail drafts. Trigger on: "find me sales prospects", "draft cold emails for my ICP",
  "build a prospect list and reach out", "find decision makers at [company type] and email them",
  "automate sales outreach", or any variation where the goal is both finding leads AND
  reaching out with personalized emails.
---

# Sales Outreach Pipeline

An end-to-end skill that takes an Ideal Customer Profile (ICP) and produces ready-to-send
Gmail drafts — handling company discovery, decision-maker identification, email enrichment,
personalized copy, and draft creation in one continuous workflow.

The pipeline has five phases. Each phase feeds into the next, with minimal human intervention.
The user reviews the final Gmail drafts and clicks send.

---

## Phase 1: Define the ICP and clarify context

### Clarify before searching

Before doing anything, extract or confirm these details. **Do not assume any — always ask if not provided:**

**About the sender's company (needed for outreach in Phase 4):**

- Company name
- What the company does (1–2 sentences)
- Key value proposition or differentiator
- The sender's name and title (for the email signature)

**About the target ICP:**

- Target role/title (e.g., "VP Engineering", "Head of Data", "CTO")
- Target company stage (e.g., "Series A–B", "50–200 employees", "public company")
- Target industry or vertical (e.g., "SaaS", "fintech", "healthcare")
- Tech stack signals if relevant (e.g., "using Postgres", "on AWS", "Python-heavy teams")
- Geography (e.g., "US-based", "San Francisco Bay Area")
- How many prospects the user wants in this batch

**About the pain point being addressed:**

- What problem does the sender's product solve for this ICP?
- What growth signal at the target company makes this a good time to reach out?
  (e.g., "rapid headcount growth → their data infra is getting stretched",
  "recent funding → they're now buying tools they couldn't afford before",
  "web traffic spike → they need to scale their backend")

Use this context to identify the *trigger* — the specific company signal that makes each
prospect worth reaching out to *right now*. This trigger becomes the email opener.

---

## Phase 2: Find matching companies

### Search by growth signals, not just firmographics

Avoid static filters like "Series B SaaS". Instead, look for companies showing *motion* —
signals that indicate they are in a state of change where the sender's product becomes
more relevant.

**Key signals to look for:**

- **Headcount growth** — hiring fast = spending, scaling infra, buying tools
- **Web traffic growth** — gaining customers = more data, more load, more complexity
- **Recent funding** — new budget to spend, pressure to move fast
- **Tech stack expansion** — adopting new tools = open to more

### Use `crustdata_company_enrich` to find and score companies

Search by domain or company name for known targets. For discovery, use web search to
find companies matching the ICP description, then enrich them.

```
crustdata_company_enrich:
  company_domain: "example.com"
  fields: "company_name,headcount,web_traffic,funding,tech_stack,founders"
```

Key fields to extract and evaluate:

- `headcount_latest.linkedin_headcount_total_growth_percent.3_months` — QoQ growth
- `headcount_latest.linkedin_headcount_total_growth_percent.1_month` — MoM growth
- `web_traffic` — monthly visitors trend
- `funding.last_round_type` and `funding.last_round_date` — recent raise?

**Scoring heuristic:**

- QoQ headcount growth > 15% → strong signal (fast-growing, buying mode)
- MoM web traffic growth > 10% → strong signal (scaling users)
- Funding round in last 6 months → strong signal (fresh budget)
- Any two signals present → include in outreach list

### Use `crustdata_web_search` for discovery

When the user doesn't have a target company list, find candidates via search:

```
crustdata_web_search:
  query: "[industry] startups [city] [tech stack] site:linkedin.com/company"
  limit: 10
```

Also search for recently funded companies:

```
crustdata_web_search:
  query: "Series B [vertical] startup [year] funding announcement"
  limit: 10
```

### Output from Phase 2

A list of target companies, each with:
- Company name and domain
- Current headcount and growth rate
- Funding stage and last round date
- The specific growth signal that makes them a good target
- Why the sender's product is relevant to them *right now*

---

## Phase 3: Find the right decision-maker

### Search by role, not just title

Use `crustdata_people_search_db` to find the specific person who owns the pain point
the sender's product addresses. Don't just grab the CEO — find the person who feels
the problem daily.

```
crustdata_people_search_db:
  params:
    filters:
      op: "and"
      conditions:
        - column: "current_employers.name"
          type: "[.]"
          value: "Target Company Name"
        - column: "current_employers.title"
          type: "(.)"
          value: "VP Engineering"
    limit: 5
```

**Title matching tips:**

- Use broad patterns: "Engineering" catches VP Engineering, Head of Engineering, Director of Engineering
- Try multiple title variations if the first search returns 0 results
- For data/AI companies: "Data", "ML", "Platform", "Infrastructure" are better targets than "Engineering"
- For smaller companies (<50 employees): the CTO is often the right person (they're hands-on)

**Exclude founders and C-suite at large companies** unless the product directly addresses executive pain.
For companies under 30 employees, the founder is often the right person.

### Verify the LinkedIn URL

**Never guess or construct LinkedIn URLs.** Use the `flagship_profile_url` from Crustdata.

If `people_search_db` returns a profile, extract `flagship_profile_url` directly.

If searching by company name returns no results, fall back to web search:

```
crustdata_web_search:
  query: "Person Name Company Name site:linkedin.com/in"
  limit: 3
```

Verify the result snippet confirms the right employer and role before using the URL.

Mark any unverified URLs as "LinkedIn URL unverified" — never fabricate a slug.

### Output from Phase 3

For each target company: the decision-maker's name, title, verified LinkedIn URL,
and one signal about them personally if available (a post they wrote, a talk they gave,
a project they shipped) — this can strengthen the opener in Phase 4.

---

## Phase 4: Find email addresses

Use the same enrichment chain as the candidate-sourcing skill.

### 4A: Business email via Crustdata enrichment

Batch up to 25 LinkedIn URLs per call:

```
crustdata_people_enrich:
  linkedin_profile_url: "url1,url2,url3..."
  fields: "name,business_email,personal_contact_info.personal_emails"
```

Always request both `business_email` and `personal_contact_info.personal_emails` in a
single call — saves a round-trip and gets both types at once.

**Expected hit rates:** ~70–80% for professionals at known companies.

### 4B: Personal email via GitHub commit history (fallback)

For technical decision-makers (engineers, CTOs, data leads) who are likely to have
a GitHub profile:

**Step 1:** Find GitHub username via web search or Crustdata enrichment response.

**Step 2:** Verify the GitHub profile belongs to this person (check bio, repos, employer mention).

**Step 3:** Find oldest non-fork repo:

```
crustdata_web_fetch:
  urls: ["https://api.github.com/users/{username}/repos?sort=created&direction=asc&per_page=5"]
```

**Step 4:** Extract email from commit patch:

```
crustdata_web_fetch:
  urls: ["https://github.com/{owner}/{repo}/commit/{sha}.patch"]
```

Extract from `From: Name <email>` header. Discard `*@users.noreply.github.com`.

### 4C: Web search fallbacks

1. `"[name]" "@gmail.com" site:github.com`
2. `"[name]" "[company]" email contact`
3. Conference speaker pages, personal websites

### Email priority

1. Personal Gmail/ProtonMail — highest response rate
2. Business email — reliable fallback
3. Mark as `no_contact` if nothing found after full chain

---

## Phase 5: Write personalized cold emails

### The one rule that matters

**Reference a specific company signal, not a generic pain point.**

"Companies your size often struggle with data infra" is a template.
"Saw your headcount grew 40% QoQ — usually means your query volumes are outpacing
your current stack" is a trigger.

The signal you found in Phase 2 (growth rate, recent funding, traffic spike) is what
makes each email feel researched rather than blasted.

### Email structure

```
Hi {first_name},

[1-sentence opener: the specific signal you found about their company, casual and direct]

[1-sentence bridge: why that signal makes your product relevant right now]

[1-sentence pitch: what you do and the ask]

[2–3 line company blurb]

{sender_name}
{sender_title}
```

Short. No headers, no bullet points, no multi-paragraph explanations.

### Writing the opener

Use the specific growth signal from Phase 2. Patterns that work:

- "Saw [Company] grew headcount [X]% last quarter — usually means [pain point] is starting to bite."
- "Noticed [Company] just raised [round] — congrats. That's usually when [specific problem] becomes a priority."
- "Saw [Company]'s web traffic is up [X]% MoM — that kind of scale tends to surface [specific problem] fast."

**Patterns that don't work (never use these):**

- Generic pain: "Companies at your stage often struggle with X" — could be sent to anyone
- Title-based: "As VP Engineering, you're probably dealing with X" — no research shown
- Compliment + pivot: "Love what [Company] is building — would love to chat" — empty
- Long explanation of your product before establishing relevance

### The bridge line

One sentence connecting their signal to why your product exists:

- "We help [ICP] [solve specific problem] so [outcome]."
- Keep it to the point — the opener already did the credibility work.

### The ask

Direct and low-friction:

- "Worth a 20-minute call?"
- "Open to a quick chat this week?"

Never pitch a demo before establishing relevance. Never ask for a meeting in the opener.

### Subject line

`[Sender Company] x [Target Company]`

or for signal-based:

`[specific trigger] → [your product]`

e.g., `40% headcount growth → Crustdata`

---

## Phase 6: Create Gmail drafts and log to tracker

### Create Gmail drafts

For each prospect with a verified email, use `gmail_create_draft`:

- `to`: prospect's email address
- `subject`: the subject line
- `body`: the full email (opener + bridge + pitch + blurb + signature)

Gmail MCP creates drafts only — the user reviews and clicks send manually.

### Log to the outreach tracker

After creating each draft, append a row to a CSV tracker:

```
/sessions/{session}/mnt/outputs/outreach_tracker_{icp_slug}.csv
```

Where `icp_slug` is lowercase-hyphenated (e.g., "VP Engineering SaaS" → `vp_engineering_saas`).

CSV headers:

```
date,icp_description,prospect_name,prospect_title,company,company_signal,linkedin_url,email,email_type,subject,message_opener,status,notes,message_body
```

```python
import csv, datetime, os

tracker_path = f"outreach_tracker_{icp_slug}.csv"
fields = [
    "date", "icp_description", "prospect_name", "prospect_title", "company",
    "company_signal", "linkedin_url", "email", "email_type", "subject",
    "message_opener", "status", "notes", "message_body"
]

row = {
    "date": datetime.date.today().isoformat(),
    "icp_description": "<ICP description>",
    "prospect_name": "<full name>",
    "prospect_title": "<title>",
    "company": "<company name>",
    "company_signal": "<e.g. 40% QoQ headcount growth>",
    "linkedin_url": "<verified linkedin url>",
    "email": "<email address>",
    "email_type": "<business / personal / github>",
    "subject": "<subject line>",
    "message_opener": "<first sentence of email>",
    "status": "drafted",
    "notes": "<any notes>",
    "message_body": "<full email body>"
}

file_exists = os.path.isfile(tracker_path)
with open(tracker_path, "a", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    if not file_exists:
        writer.writeheader()
    writer.writerow(row)
```

**Status values:** `drafted`, `sent`, `replied`, `no_contact`, `skipped`

### Prospects without email

Log with `status: "no_contact"` and note what was tried. User can decide whether to pursue LinkedIn DM or other channels manually.

---

## Batch workflow for efficiency

When processing many prospects (>5):

1. **Discover and score companies** (Phase 2) — build full list with signals first
2. **Find decision-makers** (Phase 3) — batch `people_search_db` calls (5–6 parallel)
3. **Batch email enrichment** (Phase 4A) — up to 25 LinkedIn URLs per call
4. **GitHub fallback** (Phase 4B) — only for technical contacts missing email
5. **Write all email copy** (Phase 5) — draft all openers in one pass using signals from Phase 2
6. **Create all Gmail drafts** (Phase 6) — create drafts and log to tracker

### Handling large API responses

Crustdata responses can exceed token limits and get saved to files. Parse with Python:

```python
import json
with open(filepath) as f:
    data = json.load(f)
inner = json.loads(data[0]['text'])
for c in inner.get('companies', []):
    print(c.get('company_name'), '|', c.get('headcount_latest'))
```

---

## Tool dependencies

This skill requires:

- **Crustdata MCP server** ([mcp.crustdata.com/mcp](https://mcp.crustdata.com/mcp)): provides `crustdata_company_enrich`, `crustdata_people_search_db`, `crustdata_people_enrich` (with `fields` supporting `business_email`, `personal_contact_info.personal_emails`), `crustdata_web_search`, `crustdata_web_fetch`
- **Gmail MCP**: `gmail_create_draft`
- **Python** (with `csv` for tracker)

---

## What NOT to do

- **Never send generic openers** — every email must reference a specific signal found in Phase 2
- **Never guess LinkedIn URLs** — always use `flagship_profile_url` from Crustdata
- **Never send emails** — Gmail MCP creates drafts only; the user reviews and sends manually
- **Never pitch before establishing relevance** — the opener earns the right to pitch
- **Never use the same opener twice** — each email is specific to that company's signal
- **Never skip email validation** — discard noreply addresses
