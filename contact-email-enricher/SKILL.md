---
name: contact-email-enricher
description: >
  Enrich a list of people with verified business and personal emails. Uses Crustdata for business emails
  and GitHub commit history + web search fallbacks (Codeforces, Facebook, Keybase) for personal emails.
  Handles batch processing, GitHub identity verification, rate limiting, and smart fallback chains.
  Trigger on: "find emails for these people", "enrich this contact list", "get emails for investors/candidates",
  "add email columns to my spreadsheet", "find email addresses", or when someone uploads a spreadsheet of
  names and wants contact info filled in. Even if they only mention business OR personal, use this skill.
---

# Contact Email Enricher

Enrich a list of people with verified **business emails** (via Crustdata) and **personal emails** (via GitHub commit history + web search fallbacks). This skill encodes hard-won patterns for what actually works at scale, including identity verification, rate limit handling, and a ranked fallback chain for personal email discovery.

---

## Overview of the approach

There are two fundamentally different email types to find, and they require different techniques:

**Business emails** come from Crustdata's people enrichment API. This is reliable and fast, but requires a LinkedIn profile URL. So step one is always resolving each person to their LinkedIn profile.

**Personal emails** are harder. The best source is GitHub commit history — git embeds the committer's email in every commit object, and older commits (pre-2020) almost always contain a real personal email rather than a privacy-masked one. When GitHub doesn't work, fall back to searching platforms where people inadvertently expose their email: Codeforces profiles, Facebook group posts, Keybase identity proofs, personal websites, and open-source project contributor lists.

---

## Phase 1: Parse the input

Read whatever the user provided — typically a spreadsheet (.xlsx/.csv) or a list in conversation.

Identify available columns. You need at minimum a **name** for each person. Any of these additional fields dramatically improve accuracy:
- **LinkedIn URL** — best identifier; skip straight to enrichment
- **Current company** — essential for disambiguating common names
- **Title/role** — helps verify you've found the right person
- **Existing email** — don't overwrite; add new emails in separate columns

Use `openpyxl` for .xlsx files. When writing results back:
- Add new columns (`Business Email (Crustdata)`, `Personal Email (GitHub)`) rather than overwriting any existing email column
- Preserve all existing data, formatting, and formulas
- Apply consistent formatting (borders, column widths) to new columns

---

## Phase 2: Resolve LinkedIn profiles

Every subsequent step depends on having a LinkedIn profile URL. If the input already has LinkedIn URLs, skip this phase for those rows.

### Primary: Crustdata people search

```
crustdata_people_search_db:
  filters:
    op: "AND"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "[Person Name]"
      - filter_type: "current_employers.name"
        type: "(.)"
        value: "[Company Name]"
```

This returns a `flagship_profile_url` — that's the human-readable LinkedIn URL you want.

### Fallback: Crustdata web search

For people who don't appear in the people database (common for angel investors, early-stage founders, or people who recently changed roles):

```
crustdata_web_search:
  query: "[Person Name] [Company] site:linkedin.com/in/"
```

### Common pitfalls in LinkedIn resolution

- **Common names**: Always include company or title context. "Michael Ma Liquid 2 Ventures" not just "Michael Ma".
- **Name variants**: Try both formal and common names — "William Drevno" vs "Will Drevno", "Robert" vs "Bob".
- **Unicode characters**: Watch for smart quotes in names like D'Arcy (U+2019 `'`) vs D'Arcy (U+0027 `'`). When matching names from spreadsheets against API results, normalize by lowercasing and comparing substrings rather than exact matches.
- **Recently changed roles**: If someone just moved companies, the database might have their old employer. Search with both old and new company if you know them.

---

## Phase 3: Business email enrichment via Crustdata

### The critical detail

You must explicitly request the `business_email` field. The default enrichment response does NOT include it.

```
crustdata_people_enrich:
  linkedin_profile_url: "[url1],[url2],[url3]..."
  fields: "name,business_email"
```

### Batch processing

Crustdata supports up to 25 comma-separated LinkedIn URLs per call. Batch aggressively to minimize API calls and time.

For a list of 28 people, that's 2 API calls instead of 28.

### Handling large responses

Enrichment responses for 25 profiles can exceed token limits and get saved to files. When this happens:

1. Note the file path from the error message
2. Parse with Python:
```python
import json
with open(filepath) as f:
    data = json.load(f)
# Each item contains the enrichment result
for item in data:
    text = json.loads(item.get('text', '{}'))
    # Navigate to business_email in the response
```

### What to expect

Business email hit rates vary by population:
- **Active professionals at known companies**: ~70-80% hit rate
- **Angel investors / independent operators**: ~40-50% hit rate
- **People between roles or at tiny startups**: ~20-30% hit rate

People without business emails from Crustdata typically fall into: angel investors with no current corporate affiliation, founders of very early-stage companies not yet in the database, or people who are simply private.

---

## Phase 4: Personal email via GitHub commit history

This is the most powerful technique for technical people. Git records the author's email in every commit, and this metadata is accessible via GitHub's API and `.patch` endpoints — even when the person has enabled email privacy settings on their GitHub profile page.

### Step 1: Find their GitHub username

Three sources, in order of reliability:

1. **Crustdata enrichment** — the people_enrich response may include GitHub profile URLs. But these can be wrong (Crustdata sometimes matches the wrong person if names are similar). You must verify.

2. **Web search** — `"[Name] [Company] GitHub site:github.com"`. Look for `github.com/username` in results.

3. **Personal website / Twitter bio** — Many engineers link to GitHub from their personal site or Twitter/X profile.

### Step 2: Verify the GitHub profile actually belongs to this person

This is critical. Crustdata's enrichment and web search can both return wrong GitHub profiles, especially for common names. A wrong GitHub profile means you'll extract the wrong person's email — which is worse than no email at all.

Verification checklist — confirm at least 2 of these match:
- **GitHub bio** mentions their known company, role, or project
- **GitHub profile name** matches (first + last name)
- **Repo topics** align with their known expertise
- **Web search confirms the connection**: search `"[github_username]" "[Person Name]" [Company]` and see if results link the two

If you can't verify the GitHub profile with reasonable confidence, skip that person rather than risk a wrong email.

### Step 3: Find their oldest non-fork repository

```
crustdata_web_fetch:
  urls: ["https://api.github.com/users/{username}/repos?sort=created&direction=asc&per_page=5"]
```

Parse the JSON response. Pick the first repo where `"fork": false`.

**Why oldest?** GitHub introduced commit email privacy features around 2017-2019. Repos created before that era almost always have real emails in their commit history. Repos from the last 3-5 years are increasingly likely to show `username@users.noreply.github.com` instead — which is useless.

**Why non-fork?** Forked repos contain other people's commits. You want repos where the person committed their own code under their own identity.

If all returned repos are forks or very recent, try:
- Fetching more repos with `per_page=20`
- Looking at their GitHub Events API for PushEvents to older repos
- Checking if they have any gists with commits

### Step 4: Extract email from commits

**Method A — Commits API (fastest)**:
```
crustdata_web_fetch:
  urls: ["https://api.github.com/repos/{owner}/{repo}/commits?per_page=1"]
```

The response contains:
```json
{
  "commit": {
    "author": {
      "name": "Person Name",
      "email": "person@gmail.com"  // ← this is what you want
    }
  },
  "sha": "abc123..."
}
```

**Method B — `.patch` endpoint (bypass privacy settings)**:

If Method A returns a noreply email, try the `.patch` endpoint on commits from older repos:
```
crustdata_web_fetch:
  urls: ["https://github.com/{owner}/{repo}/commit/{sha}.patch"]
```

The response contains RFC 2822 headers:
```
From abc123def456 Mon Sep 17 00:00:00 2001
From: Person Name <person@gmail.com>
Date: Tue, 15 Jan 2019 10:30:00 +0530
Subject: [PATCH] Initial commit
```

Extract the email from the `From:` line using:
```python
import re
match = re.search(r'From: .+? <([^>]+)>', patch_text, re.MULTILINE)
# Also handle HTML-encoded: From: .+? &lt;([^&]+)&gt;
```

### Step 5: Validate the extracted email

Discard these synthetic/useless patterns:
- `*@users.noreply.github.com` (GitHub privacy mask)
- `noreply@github.com`
- `try_git@github.com` (GitHub tutorial artifact)
- Any email containing `noreply`
- Emails that are clearly auto-generated (long numeric prefixes)

A valid personal email will typically be `@gmail.com`, `@yahoo.com`, `@hotmail.com`, `@protonmail.com`, a university domain, or a personal domain.

### Handling GitHub API rate limits

GitHub allows only 60 unauthenticated API requests per hour. When you hit the limit, the API returns:
```json
{"message": "API rate limit exceeded..."}
```

Workarounds, in order:
1. **Use the `.patch` endpoint** — it doesn't count against the REST API rate limit
2. **Fetch HTML commits pages** — `https://github.com/{owner}/{repo}/commits` returns HTML that contains commit SHAs. Extract SHAs with regex: `re.findall(r'[a-f0-9]{40}', html_content)`, then use `.patch` on those SHAs.
3. **Batch your API calls** — use `crustdata_web_fetch` with multiple URLs in a single call (up to 10) to minimize round trips.
4. **Process in waves** — if you have many people, process the API-dependent steps first for as many as you can, then switch to non-API methods while the rate limit resets.

---

## Phase 5: Personal email via web search fallbacks

When GitHub doesn't yield a personal email (no GitHub profile, all repos are recent, or all commits use noreply), search platforms where people inadvertently expose their email.

### Ranked fallback chain

Try these in order. Each one is progressively less likely to work but catches different populations:

1. **GitHub issues/READMEs**: `"[name]" "@gmail.com" site:github.com`
   People sometimes paste their email in issue comments, README contact sections, or contributor files.

2. **Facebook groups/posts**: `"[name]" email OR "@gmail.com" site:facebook.com`
   Found in introduction posts in professional groups, event RSVPs, and community threads. (This is how we found Eric Migicovsky's personal email from a Pebble community Facebook group.)

3. **Competitive programming profiles**: `"[name]" site:codeforces.com` or `"[name]" site:leetcode.com`
   Technical people often have accounts on Codeforces, LeetCode, or similar platforms that display their email. (This is how we confirmed Kaushik Iska's personal email from his Codeforces profile.)

4. **Keybase**: `"[name]" site:keybase.io`
   Identity proofs on Keybase link GitHub, Twitter, and sometimes include email verification.

5. **Personal websites**: `"[name]" "[company]" email contact`
   Check their personal domain (often linked from GitHub or Twitter bio). Contact pages frequently list personal email.

6. **Conference talks / speaker pages**: `"[name]" "[company]" speaker email`
   Conference speaker bios sometimes include direct email.

7. **Academic profiles**: `"[name]" site:scholar.google.com OR site:dblp.org`
   For people with academic backgrounds, their papers or faculty pages may list email.

### When to use web search vs GitHub

- **Engineers with active GitHub profiles**: Start with GitHub (Phase 4), fall back to web search only if GitHub fails.
- **Non-technical people** (VCs, operators, business roles): Skip GitHub entirely, go straight to web search.
- **Technical people without GitHub**: They might have GitLab, Bitbucket, or other forge profiles. Search for those too.

---

## Phase 6: Write results back

### Spreadsheet output

```python
import openpyxl
from openpyxl.styles import Font, Alignment, Border, Side

wb = openpyxl.load_workbook('input.xlsx')
ws = wb.active

# Add new column headers (don't overwrite existing columns)
next_col = ws.max_column + 1
ws.cell(row=1, column=next_col, value='Business Email (Crustdata)')
ws.cell(row=1, column=next_col + 1, value='Personal Email (GitHub)')

# Style headers
for col in [next_col, next_col + 1]:
    cell = ws.cell(row=1, column=col)
    cell.font = Font(bold=True, size=10)
    cell.alignment = Alignment(vertical='center')

# Fill in data row by row
# ...

# Set column widths
ws.column_dimensions[openpyxl.utils.get_column_letter(next_col)].width = 35
ws.column_dimensions[openpyxl.utils.get_column_letter(next_col + 1)].width = 28

wb.save('output.xlsx')
```

### Conversation output

If the input was a list in conversation (not a file), present results in a clear table format, noting which emails were found via which method and flagging any low-confidence results.

---

## Batch processing strategy

For large lists (>10 people), use this workflow to minimize time and API calls:

1. **Batch LinkedIn resolution** — resolve all names to LinkedIn URLs first
2. **Batch business email enrichment** — send up to 25 LinkedIn URLs per Crustdata enrichment call
3. **Triage for GitHub** — identify which people are likely engineers (based on title, company type, or bio) and prioritize them for GitHub email extraction
4. **Batch GitHub API calls** — use `crustdata_web_fetch` with multiple GitHub URLs per call (up to 10)
5. **Web search in parallel** — for people where GitHub didn't work, run web searches

### Efficiency tips

- Don't search for personal emails for people who already have a personal email in the input data (unless asked to verify)
- For large lists, process GitHub API calls in waves of ~15-20 to stay within rate limits
- Parse large API responses with Python scripts rather than trying to process them inline
- Keep a running tally of what's been found vs what's still missing, and report progress

---

## Real examples from production use

### Example 1: Business email found via Crustdata
**Input**: Topher Conway, Managing Partner at SV Angel, LinkedIn: linkedin.com/in/topherc
**Process**: `crustdata_people_enrich` with `fields: "name,business_email"`
**Result**: `topher@svangel.com`

### Example 2: Personal email from old GitHub repo
**Input**: Pete Koomen, General Partner at Y Combinator
**Process**: Found GitHub `koomen` → repo `koomen/koomen.dev` (created 2019) → commit author email
**Result**: `koomen@gmail.com`

### Example 3: Personal email from web search (Facebook group)
**Input**: Eric Migicovsky, Pebble founder, YC Partner
**Process**: GitHub `ericmigi` had only test repos with generic emails. Web search `"ericmigi" email` found a Facebook group post.
**Result**: `ericmigi@gmail.com`

### Example 4: Personal email from Codeforces
**Input**: Kaushik Iska, PeerDB/ClickHouse engineer
**Process**: GitHub `iskakaushik` was rate-limited. Web search `"Kaushik Iska" email site:codeforces.com` found his profile.
**Result**: `iska.kaushik@gmail.com` (confirmed as same email already known)

### Example 5: GitHub profile verification prevented wrong email
**Input**: Ali Kashani, CEO of Serve Robotics
**Process**: Crustdata enrichment returned GitHub profile `alikashani`. Verification check: GitHub bio mentioned a different company/person entirely. Profile rejected.
**Result**: No personal email extracted (correct — would have been wrong person's email)

### Example 6: Noreply on all commits
**Input**: Honglei Liu, Head of ML at Twitter, TofuHQ founder
**Process**: GitHub `ppuliu` verified via ML repos matching background. But all commits (even oldest, 2015) used `ppuliu@users.noreply.github.com`.
**Result**: No personal email from GitHub. Business email `honglei@tofuhq.com` found via Crustdata.

---

## Decision flowchart

```
For each person:
├── Has LinkedIn URL? → Use directly
│   └── No → Search via crustdata_people_search_db → Fallback to web search
│
├── Enrich with crustdata_people_enrich (fields: "name,business_email")
│   └── Got business_email? → Record it
│
├── Is this person likely technical? (engineer, founder of tech company, etc.)
│   ├── Yes → Search for GitHub profile
│   │   ├── Found GitHub? → Verify identity (bio, name, repos match known info)
│   │   │   ├── Verified → Find oldest non-fork repo → Extract commit email
│   │   │   │   ├── Real email found → Record it
│   │   │   │   └── Noreply/none → Try .patch on older commits → Try web search fallbacks
│   │   │   └── Not verified → Skip GitHub, try web search fallbacks
│   │   └── No GitHub → Try web search fallbacks
│   └── No → Try web search fallbacks only (skip GitHub)
│
└── Record results, move to next person
```

---

## Tool dependencies

This skill requires:
- **Crustdata MCP tools**: `crustdata_people_search_db`, `crustdata_people_enrich`, `crustdata_web_search`, `crustdata_web_fetch`
- **Python** (with `openpyxl`): for spreadsheet I/O and parsing large API responses
- **Web search** (Crustdata or general): for fallback email discovery
