---
name: email-enrichment
description: >
  Enrich a list of email addresses to find the person behind each one (email to person profile).
  Uses a 5-phase waterfall across Crustdata MCP tools: crustdata_company_identify,
  crustdata_people_enrich, crustdata_people_search_db (three different filter strategies).
  Handles rate limiting, verification, progress saving, and resume.
  Trigger on: "enrich these emails", "who are these people", "find info for these email addresses",
  "look up these contacts", "identify people from emails", "reverse email lookup", "email to profile",
  or when someone provides a list/CSV/spreadsheet of email addresses wanting contact info.
---

# Email Enrichment

Two directions, one skill:

1. **Email to person** - Turn a list of email addresses into rich contact profiles (name, title, company, profile URL). Uses a 5-phase waterfall optimized for coverage and accuracy.
2. **Person to email** - Find business emails, personal emails, and phone numbers for a list of people. Uses enrichment with personal contact info, plus GitHub commit fallbacks for technical people.

---

## Overview

The approach uses five phases in a strict waterfall. Each phase catches emails that earlier phases missed. The phases are ordered by cost (free first, then cheapest) and reliability (highest precision first).

| Phase | MCP Tool | Targets | Cost |
|-------|----------|---------|------|
| 1 | `crustdata_company_identify` | Work + Edu emails | FREE |
| 2 | `crustdata_people_enrich` | Work + Edu emails | Credits |
| 3 | `crustdata_people_search_db` (name+company) | Missed work/edu | Credits |
| 4 | `crustdata_people_search_db` (emails contains) | ALL remaining | Credits |
| 5 | `crustdata_people_search_db` (name only) | Remaining personal | Credits |

**Coverage rates:**

| Category | Person Match | Company Match |
|----------|-------------|---------------|
| Work emails | 95%+ | 95%+ |
| Edu emails | 95%+ | 95%+ |
| Personal emails | 95%+ | N/A |
| **Blended** | **95%+** | **95%+** |

---

## Phase 0: Parse input and classify emails

### Read the input

Accept CSV files, spreadsheets (.xlsx/.csv), or inline lists. Extract all email addresses. Deduplicate.

### Classify each email into one of three categories

**Personal email domains** (match against this list):
```
gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, me.com,
live.com, protonmail.com, proton.me, msn.com, ymail.com, comcast.net, att.net,
verizon.net, mac.com, fastmail.com, hey.com, pm.me, zoho.com, gmx.com,
googlemail.com
```

**Edu email domains** (match against these TLD patterns):
```
.edu, .ac.uk, .ac.jp, .ac.kr, .ac.in, .ac.nz, .ac.za
```

**Work emails**: everything else.

### Name extraction from email prefix

Split the local part (before `@`) on dots, underscores, and hyphens. Remove any parts that are purely digits. Capitalize each remaining part. Only keep parts with 2+ characters.

```python
import re

def extract_name_parts(email):
    local = email.split("@")[0]
    parts = re.split(r'[._\-]', local)
    parts = [p for p in parts if not p.isdigit()]
    parts = [p.capitalize() for p in parts if len(p) >= 2]
    return parts

# Examples:
# "daniel_k_lee@brown.edu"   -> ["Daniel", "Lee"]
# "john.smith@acme.com"      -> ["John", "Smith"]
# "jsmith123@gmail.com"      -> ["Jsmith"]
# "a.rodriguez@company.com"  -> ["Rodriguez"]
```

---

## Phase 1: Company Identify (FREE)

Identify the company behind each non-personal email domain. This phase is FREE and should always run first.

### MCP tool call

```
crustdata_company_identify:
  company_website: "domain.com"
```

### What it returns

Company name, professional network URL, website, description, and other firmographic data. Returned as part of the tool result.

### How to run it

Deduplicate domains first. A list of 1,000 work emails might only have 200 unique domains.

For each unique domain extracted from work + edu emails:

```
crustdata_company_identify:
  company_website: "acme.com"
```

Store the result in a domain_map: `domain -> company_name`. This will be used in Phase 3 and Phase 4 for verification.

### Expected results

- 95%+ of work email domains will be identified
- Edu domains are nearly 100% (universities are well-known)

---

## Phase 2: Person Enrich via business_email

Look up each work and edu email directly using person enrichment.

### MCP tool call

```
crustdata_people_enrich:
  business_email: "john@acme.com"
  fields: "name,business_email"
```

### Critical details

- `business_email` takes a **single email string**
- `linkedin_profile_url` and `business_email` are **mutually exclusive** -- you cannot use both in the same call
- Despite the name "business_email", this works for edu emails too (especially faculty/staff)
- Returns person data including: name, headline, profile URL, current and past employers

### How to run it

For each work + edu email:

```
crustdata_people_enrich:
  business_email: "stephen@spero.vc"
  fields: "name,business_email"
```

If a match is returned (has a `name` field), record it. If no match, the email moves to Phase 3.

### Expected results

- Majority of work+edu emails will match directly
- Higher for professionals at established companies
- The 5-phase waterfall catches what direct enrich misses

---

## Phase 3: PersonDB name+company search

For work/edu emails that Phase 2 missed, try a name+company search. Extract a name guess from the email prefix and combine it with the company identified in Phase 1.

### When to use

Only for emails where:
1. Phase 2 returned no match
2. The email is work or edu (not personal)
3. The domain was identified in Phase 1 (we know the company name)
4. At least one name part can be extracted from the email prefix

### MCP tool call

```
crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "FirstName"
      - filter_type: "current_employers.name"
        type: "(.)"
        value: "CompanyName"
  page_size: 3
```

Note: use `filter_type` as the key for `name` and `current_employers.name` fields.

### Verification (required)

The returned profile's name must contain the first name extracted from the email prefix:

```python
def verify_name_match(email_name_parts, profile_name):
    if not email_name_parts or not profile_name:
        return False
    return email_name_parts[0].lower() in profile_name.lower()
```

### How to run it

For each missed work/edu email, extract the name and look up the company from the domain_map:

```
# For email: kyle@backswingventures.com
# Name parts: ["Kyle"]
# Company from Phase 1: "Backswing Ventures"

crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "Kyle"
      - filter_type: "current_employers.name"
        type: "(.)"
        value: "Backswing Ventures"
  page_size: 3
```

Check each returned profile: does "kyle" appear in the profile's name? If yes, it's a match.

### Expected results

- Catches emails that Phase 2 missed using name + company compound search
- Works best for emails with clear name formats (john.smith@, daniel_lee@)

---

## Phase 4: PersonDB email contains search + verification

Search PersonDB's `emails` field, which contains personal and alternative email addresses stored in profiles. This works for ALL email types: work, edu, and personal.

### Critical implementation details

1. The `emails` field in PersonDB is an **array field** containing personal emails
2. You MUST use `"column"` as the key (not `"filter_type"`) -- this is a PersonDB-specific requirement for this field
3. Search on the **local part only** (before the @) to catch cases where the domain might differ
4. This is the **highest false-positive phase** -- verification is essential

### MCP tool call

```
crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - column: "emails"
        type: "(.)"
        value: "LOCAL_PART_OF_EMAIL"
  page_size: 5
```

**IMPORTANT:** Use `column` here, NOT `filter_type`. The `emails` field requires the `column` key. Using `filter_type` will silently return zero results.

### How to run it

For each remaining unmatched email (work, edu, AND personal):

```
# For email: joanne.bradford@gmail.com
# Local part: "joanne.bradford"

crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - column: "emails"
        type: "(.)"
        value: "joanne.bradford"
  page_size: 5
```

### Verification logic (CRITICAL -- do not skip)

Without verification, contains searches produce false positives. For example, searching for "wraecca" might match "Alessandro Racca" because "racca" is a substring.

**For every result, verify ALL of the following:**

**Step 1 -- Name verification (required for all email types):**
- Extract name parts from the email prefix
- If 2+ name parts: BOTH first AND last must appear in the profile name
- If 1 name part: that part must appear in the profile name, and the part must be 3+ characters

**Step 2 -- Organization verification (required for work and edu emails):**
- Look up the company/institution from the domain_map (Phase 1)
- Extract significant words from the org name (skip common words like "the", "inc", "llc", "of")
- At least one significant org word must appear somewhere in the profile data (check employers, education, headline)
- If no org word matches, reject the result even if the name matched

**Step 3 -- Personal emails (name check only):**
- For personal emails (gmail, yahoo, etc.), there is no org to cross-reference
- The name match from Step 1 is the only gate
- This means personal email matches have lower precision

```python
def verify_phase4_match(email, name_parts, profile, domain_map):
    profile_name = profile.get("name", "").lower()

    # Name verification
    if len(name_parts) >= 2:
        if not (name_parts[0].lower() in profile_name and name_parts[-1].lower() in profile_name):
            return False
    elif len(name_parts) == 1 and len(name_parts[0]) > 2:
        if name_parts[0].lower() not in profile_name:
            return False
    else:
        return False

    # Org verification for work/edu
    domain = email.split("@")[1]
    company_info = domain_map.get(domain)
    if company_info:
        org_name = company_info.get("name", "")
        skip = {"the", "inc", "llc", "ltd", "co", "corp", "of", "and", "for", "university", "college"}
        org_words = [w.lower() for w in org_name.split() if w.lower() not in skip and len(w) > 2]
        profile_str = str(profile).lower()
        if org_words and not any(w in profile_str for w in org_words):
            return False

    return True
```

### Expected results

- The biggest single fallback improvement in the waterfall
- Works across all email types (work, edu, personal)
- For edu emails, cross-references against institution name
- For work emails, cross-references against company from Phase 1
- For personal emails, name match only (lower precision)

---

## Phase 5: PersonDB name search for personal emails

Last resort for personal emails where we can extract a plausible full name from the email prefix.

### When to use

Only for emails where:
1. All previous phases returned no match
2. The email is personal (gmail, yahoo, etc.)
3. At least 2 name parts can be extracted from the email prefix

### MCP tool call

```
crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "FirstName LastName"
  page_size: 5
```

### Acceptance criteria

- The search must return **3 or fewer results** (low ambiguity)
- If 4+ results come back, skip -- too many possible matches
- The returned name must reasonably match the extracted name parts

### How to run it

```
# For email: joanne.bradford@gmail.com
# Name parts: ["Joanne", "Bradford"]

crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "Joanne Bradford"
  page_size: 5
```

If 1-3 results returned, take the first one. If 0 or 4+, mark as unmatched.

### Expected results

- Catches remaining personal emails with clear first.last patterns
- The 3-result ceiling prevents matching the wrong person for common names

---

## Rate limiting

Crustdata uses a leaky bucket algorithm. Requests must be distributed evenly -- bursting will trigger 429 errors even if you are under the per-minute limit.

**Default rate limits:**

| MCP Tool | Endpoint | RPM | Min Interval |
|----------|----------|----:|-------------:|
| `crustdata_company_identify` | `/screener/identify` | 30 | 2 seconds |
| `crustdata_people_enrich` | `/screener/person/enrich` | 15 | 4 seconds |
| `crustdata_people_search_db` | `/screener/persondb/search` | 60 | 1 second |
| `crustdata_web_search` | `/screener/web-search` | 10 | 6 seconds |

When processing large lists, space out MCP tool calls accordingly. If you get rate-limited (429 error in the tool response), back off with exponential delays: wait 2s, then 4s, then 8s before retrying.

### Optimization: deduplicate domains in Phase 1

A list of 1,000 work emails might only have 200 unique domains. Always deduplicate domains before calling `crustdata_company_identify`.

---

## Progress saving and resumability

For large lists, save progress to a JSON file after each phase so the enrichment can resume if interrupted.

### Progress file format

```json
{
  "phase_completed": 3,
  "domain_map": {
    "acme.com": {"name": "Acme Corp"},
    "stanford.edu": {"name": "Stanford University"}
  },
  "results": {
    "john@acme.com": {
      "name": "John Smith",
      "headline": "VP Engineering at Acme",
      "company": "Acme Corp",
      "method": "person_enrich"
    }
  },
  "unmatched_emails": ["unknown@gmail.com"]
}
```

### Resume logic

On start, check if a progress file exists. If it does, skip phases that are already complete and continue from where it left off.

---

## Output

### CSV output

Generate a CSV with these columns:

| Column | Description |
|--------|-------------|
| `email` | Original email address |
| `category` | `work`, `edu`, or `personal` |
| `person_name` | Full name of the person |
| `person_headline` | Job title / headline |
| `company_name` | Company or institution name |
| `profile_url` | Professional profile URL |
| `method` | Which phase found the match: `person_enrich`, `name+company`, `email_contains`, `name_search` |

### Summary statistics

Print a summary at the end:

```
=== Email Enrichment Results ===
Total emails: {N}
  Work:     {W}  | Person: {P1} ({P1%})  | Company: {C1} ({C1%})
  Edu:      {E}  | Person: {P2} ({P2%})  | Company: {C2} ({C2%})
  Personal: {R}  | Person: {P3} ({P3%})  | Company: {C3} ({C3%})
  Overall:  {N}  | Person: {PT} ({PT%})  | Company: {CT} ({CT%})

Breakdown by method:
  Phase 2 (person_enrich):    {count}
  Phase 3 (name+company):     {count}
  Phase 4 (email_contains):   {count}
  Phase 5 (name_search):      {count}
```

---

## Decision flowchart

```
For each email:
|
+-- Classify: work / edu / personal
|
+-- Phase 1: Is it work or edu?
|   +-- Yes -> Extract domain -> crustdata_company_identify(company_website=domain)
|   |   +-- Found company? -> Store in domain_map
|   |   +-- Not found? -> Continue (no company info for this domain)
|   +-- No (personal) -> Skip to Phase 4
|
+-- Phase 2: Is it work or edu?
|   +-- Yes -> crustdata_people_enrich(business_email=email, fields="name,business_email")
|   |   +-- Found person? -> DONE (method=person_enrich)
|   |   +-- Not found? -> Continue to Phase 3
|   +-- No (personal) -> Skip to Phase 4
|
+-- Phase 3: Is it work/edu AND have company name AND name parts?
|   +-- Yes -> crustdata_people_search_db(filters: name + current_employers.name)
|   |   +-- Found + name verified? -> DONE (method=name+company)
|   |   +-- Not found? -> Continue to Phase 4
|   +-- No -> Skip to Phase 4
|
+-- Phase 4: Still unmatched? (any email type)
|   +-- crustdata_people_search_db(filters: column="emails", type="(.)", value=local_part)
|   +-- For each result, verify:
|   |   +-- Name parts match profile name? (required)
|   |   +-- Work/edu: org appears in profile history? (required)
|   |   +-- Personal: name match only (no org check possible)
|   +-- Verified match? -> DONE (method=email_contains)
|   +-- No verified match? -> Continue to Phase 5
|
+-- Phase 5: Is it personal AND has 2+ name parts?
|   +-- Yes -> crustdata_people_search_db(filters: name="FirstName LastName")
|   |   +-- 1-3 results returned? -> DONE (method=name_search)
|   |   +-- 0 or 4+ results? -> UNMATCHED
|   +-- No -> UNMATCHED
```

---

## Key learnings

1. **The `emails` field in PersonDB uses `"column"` not `"filter_type"`.** Using the wrong key returns zero results silently.

2. **Verification prevents false positives.** Without verification in Phase 4, substring matching on email local parts produces bad matches.

3. **Edu emails work with `crustdata_people_enrich`.** Despite the parameter being called `business_email`, it matches faculty and staff at universities.

4. **Phase 3 (name+company) adds significant value.** The combination of a name guess from the email prefix plus a known company name is an effective compound search.

5. **Phase 4 (email contains) is the biggest fallback win.** Searching PersonDB's emails array catches cases where someone's personal email is stored in their profile.

6. **Personal emails are the hardest.** Without a company to cross-reference, verification is limited to name matching.

7. **`crustdata_people_enrich` params `linkedin_profile_url` and `business_email` are mutually exclusive.** Cannot pass both in the same call.

8. **`crustdata_people_search_db` returns results in a `profiles` key**, not `data`.

---

---

# Person-to-Email Enrichment

When the input is a list of **people** (names, profile URLs, or both) and the goal is to find their **email addresses**, use this flow instead.

---

## Step 1: Resolve profile URLs

If the input already has profile URLs, skip this step.

If only names + companies are provided, resolve to profile URLs first:

```
crustdata_people_search_db:
  filters:
    op: "and"
    conditions:
      - filter_type: "name"
        type: "(.)"
        value: "Person Name"
      - filter_type: "current_employers.name"
        type: "(.)"
        value: "Company Name"
  page_size: 3
```

The result includes a `flagship_profile_url` field - that's the profile URL you need.

**Fallback:** If not found in PersonDB, try web search:

```
crustdata_web_search:
  query: "Person Name Company site:linkedin.com/in/"
```

Extract the profile URL from the top result.

### Common pitfalls

- **Common names**: always include company or title context. "Michael Ma Liquid 2 Ventures" not just "Michael Ma".
- **Name variants**: try both formal and common names - "William Drevno" vs "Will Drevno", "Robert" vs "Bob".
- **Recently changed roles**: search with both old and new company if you know them.

---

## Step 2: Enrich business emails

Batch up to 25 profile URLs per call. You MUST include `business_email` in the fields parameter - it is not returned by default.

```
crustdata_people_enrich:
  linkedin_profile_url: "https://linkedin.com/in/person1,https://linkedin.com/in/person2,..."
  fields: "name,business_email"
```

### Critical details

- Up to **25 comma-separated profile URLs** per call
- `business_email` must be explicitly requested in `fields`
- `linkedin_profile_url` and `business_email` params are mutually exclusive - this call uses `linkedin_profile_url`
- The response is an array. Map results back to input URLs using the `linkedin_profile_url` or `linkedin_flagship_url` field in each result.

### Handling large lists

For 25+ profiles, batch into groups of 25 and call sequentially. Parse responses with Python if they exceed token limits.

---

## Step 3: Enrich personal emails and phone numbers

For profiles where you also need personal contact info, make a separate call with the personal contact fields:

```
crustdata_people_enrich:
  linkedin_profile_url: "https://linkedin.com/in/person1,https://linkedin.com/in/person2,..."
  fields: "personal_contact_info.personal_emails,personal_contact_info.phone_numbers"
```

### Credit usage

- **2 credits** per profile for `personal_contact_info.personal_emails`
- **2 credits** per profile for `personal_contact_info.phone_numbers`
- These are additive on top of the base enrichment cost

### Access

Personal contact info enrichment is access-controlled. Not all accounts have it enabled. If the fields come back empty, the account may need this feature turned on.

### Combining with business email

You can request everything in one call:

```
crustdata_people_enrich:
  linkedin_profile_url: "https://linkedin.com/in/person1"
  fields: "name,business_email,personal_contact_info.personal_emails,personal_contact_info.phone_numbers"
```

---

## Step 4: GitHub fallback for personal emails (technical people)

If personal contact info enrichment is not available or returns empty for technical people, fall back to GitHub commit history. This only works for engineers, developers, and technical founders.

### Find their GitHub username

```
crustdata_people_enrich:
  linkedin_profile_url: "https://linkedin.com/in/person1"
  fields: "github_profiles"
```

Or search the web:

```
crustdata_web_search:
  query: "Person Name Company site:github.com"
```

### Verify the GitHub profile

Confirm at least 2 of these match: GitHub bio mentions their company/role, profile name matches, repo topics align with their expertise.

### Extract email from commits

Use `crustdata_web_fetch` to read the oldest non-fork repo's commits:

```
crustdata_web_fetch:
  url: "https://api.github.com/users/USERNAME/repos?sort=created&direction=asc&per_page=5"
```

Then fetch the commit email:

```
crustdata_web_fetch:
  url: "https://github.com/OWNER/REPO/commit/SHA.patch"
```

Extract the email from the `From:` header in the patch. Discard `noreply@github.com` and `*@users.noreply.github.com` addresses.

---

## Person-to-email expected results

- **Business emails**: 95%+ of professionals at known companies
- **Personal emails**: 95%+ via enrichment API with personal contact info enabled
- **Phone numbers**: 95%+ via enrichment API with personal contact info enabled

---

## MCP tool reference

| Tool | Purpose | Key parameters |
|------|---------|---------------|
| `crustdata_company_identify` | Domain to company (FREE) | `company_website` (domain string) |
| `crustdata_people_enrich` | Email to person, or person to emails | `business_email` OR `linkedin_profile_url`, `fields` |
| `crustdata_people_search_db` | Search people by filters | `filters` (object with `op`, `conditions`), `page_size` |
| `crustdata_web_search` | Web search (find profiles, fallback) | `query` (search string) |
| `crustdata_web_fetch` | Fetch page content (GitHub commits) | `url` (page URL) |

MCP server: `mcp.crustdata.com/mcp`

---

## Tool dependencies

This skill requires the **Crustdata MCP server** connected at [mcp.crustdata.com/mcp](https://mcp.crustdata.com/mcp). It provides:
- `crustdata_company_identify`
- `crustdata_people_enrich`
- `crustdata_people_search_db`
- `crustdata_web_search`
- `crustdata_web_fetch`
