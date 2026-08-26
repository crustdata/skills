---
name: email-enrichment
description: >
  Enrich a list of email addresses to find the person behind each one (email to person profile).
  Uses a six-phase waterfall over the Crustdata Code Mode MCP, calling these tools inside execute()
  scripts: company_identify, person_enrich (business_emails) / batch_person_identify, person_search
  (name+company and name-only strategies), web_search_live, web_enrich_live.
  Handles verification, progress saving, and resume.
  Trigger on: "enrich these emails", "who are these people", "find info for these email addresses",
  "look up these contacts", "identify people from emails", "reverse email lookup", "email to profile",
  or when someone provides a list/CSV/spreadsheet of email addresses wanting contact info.
version: 0.1.1
display-name: Email Enrichment
category: sales-gtm
icon: mail-search
summary: "Turn emails into contact profiles, or turn a list of people into verified emails and phones."
sample-prompts:
  - "Here's a CSV of 500 emails from our calendar events. Who are these people?"
  - "Find business emails for these 10 investors"
  - "Identify the people behind these personal Gmail addresses"
---

# Email Enrichment

Two directions, one skill:

1. **Email to person** - Turn a list of email addresses into rich contact profiles (name, title, company, profile URL). Uses a six-phase waterfall optimized for coverage and accuracy.
2. **Person to email** - Find business emails, personal emails, and phone numbers for a list of people. Uses enrichment with personal contact info, plus GitHub commit fallbacks for technical people.

---

## Overview

The approach uses six phases in a strict waterfall. Each phase catches emails that earlier phases missed. The phases are ordered by cost (free first, then cheapest) and reliability (highest precision first).

All Crustdata work runs inside `execute({ code })` scripts — write a short plain-JavaScript script whose only I/O is `const r = await callTool("<tool>", params)`, then branch on `r.ok`. Author it against the TypeScript-typed tool surface from `get_schema`, but put NO type annotations in the body — a `: Type`, `as`, or `interface` is a parse error that fails the whole run. See the per-phase scripts below.

| Phase | Crustdata tool (via `callTool`) | Targets | Cost |
|-------|----------|---------|------|
| 1 | `company_identify` | Work + Edu emails | FREE |
| 2 | `person_enrich` (`business_emails`) + post-verification | Work + Edu | ~1-2 cr/profile |
| 2 (personal) | `batch_person_identify` (async) | Personal | 1 cr/matched |
| 3 | `person_search` (name+company) | Missed work/edu | ~0.03 cr/result |
| 4 | `person_search` (name only) | Remaining personal | ~0.03 cr/result |
| 5 | `web_search_live` + `person_enrich` | ALL remaining | 1 cr/query + enrich |
| 6 | Scoring gate | ALL candidates from Phases 3-5 | N/A |

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

### Script

`company_identify` takes a `domains` array, so deduplicate domains first (a list of 1,000 work emails might only have 200 unique domains) and resolve them all in ONE call.

```ts
// model query: identify the company behind each work/edu email domain
const domains = [...new Set(workEduEmails.map(e => e.split("@")[1].toLowerCase()))];
const r = await callTool("company_identify", { domains });
if (!r.ok) return { error: r.message };

// build domain_map: domain -> { name, primary_domain, professional_network_url }
const domainMap = {};
for (const rec of r.data) {
  const info = rec.matches?.[0]?.company_data?.basic_info;
  if (info) domainMap[rec.matched_on.toLowerCase()] = {
    name: info.name,
    primary_domain: info.primary_domain,
    professional_network_url: info.professional_network_url,
  };
}
return { domainMap };
```

### What it returns

An ARRAY of `{ matched_on, match_type, matches: [{ confidence_score, company_data }] }`. Read the company off `matches[0].company_data.basic_info` (`name`, `primary_domain`, `website`, `professional_network_url`, `description`, `year_founded`, …). `matched_on` is the domain you passed in, so you can map results back to inputs directly.

### How to run it

Store the result in a domain_map: `domain -> { name, ... }`. This `domainMap` is returned and passed back into later phases (via `inputs`) for Phase 3 verification — don't re-run this free call per-domain.

### Expected results

- 95%+ of work email domains will be identified
- Edu domains are nearly 100% (universities are well-known)

---

## Phase 2: Person Enrich via business email (work/edu)

Look up each work/edu email directly using person enrichment. Phase 2 branches based on email type:

- **Work/edu emails** -> use the `business_emails` identifier + post-verification (Branch A below)
- **Personal emails** -> see Branch B — the async `batch_person_identify` path, with the name-based phases as fallback

### Branch A: Work/edu emails (business_emails)

#### Script

`person_enrich` takes a `business_emails` ARRAY (≤25 per call), so batch the work/edu emails. Pass `fields: ["basic_profile", "experience"]` to get the name + employers needed for post-verification. Each call returns one record per input email; map results back via `matched_on`.

```ts
// model query: enrich work/edu emails to find the person behind each
const r = await callTool("person_enrich", {
  business_emails: workEduEmailBatch,          // ≤25 emails
  fields: ["basic_profile", "experience"],     // name + current/past employers
});
if (!r.ok) return { error: r.message };

// r.data is an ARRAY of { matched_on, match_type, matches: [{ confidence_score, person_data }] }
const byEmail = {};
for (const rec of r.data) {
  const pd = rec.matches?.[0]?.person_data;
  if (pd) byEmail[rec.matched_on.toLowerCase()] = pd;   // post-verify before accepting
}
return { byEmail };
```

For more than 25 work/edu emails, `chunk(emails, 25)` then `await parallelMap(batches, b => callTool("person_enrich", { business_emails: b, fields: ["basic_profile", "experience"] }))`.

#### Critical details

- `business_emails` takes an **array of email strings** (≤25 per call)
- Pass ONE identifier kind per call — `professional_network_profile_urls` and `business_emails` are not combined in the same call
- Despite the name "business_emails", this works for edu emails too (especially faculty/staff)
- Returns `person_data` including: `basic_profile.name`, `basic_profile.headline`, `social_handles.professional_network_identifier.profile_url`, and `experience.employment_details.current[]` / `.past[]` (employers)
- Set `preview: true` for a 0-credit base-profile check before paying

If a match is returned (`matches[0].person_data` has a name), it MUST pass post-verification before accepting (see Post-verification section below).

### Branch B: Personal emails (reverse personal-email lookup)

> **Async only:** Personal emails (gmail/yahoo/outlook) resolve through the ASYNC
> `batch_person_identify` — the only tool that matches personal emails. The sync tools cannot:
> `person_enrich` accepts only `professional_network_profile_urls` or `business_emails` as
> identifiers, `person_enrich_live` accepts only profile URLs, and `person_search` has no
> `emails` filter column.
>
> **How:** submit `batch_person_identify({ emails: [...] })` (≤300 per job), poll
> `batch_job_get(batch_id)` until `completed`, then read the `batch_results` rows —
> `matches[0].person_data` carries the same ids/basic_profile/profile-URL shape as Branch A.
> 1 credit per MATCHED identifier; unmatched identifiers are free. For emails it does not match,
> fall through to:
> 1. **Phase 4** — `person_search` by the full name extracted from the email prefix (works when
>    the prefix is a clear `first.last` pattern), then `person_enrich` by the resulting profile URL.
> 2. **Phase 5** — `web_search_live({ query: "who is EMAIL", sources: ["ai"] })` to resolve the
>    owner's name, then `person_search` → `person_enrich`.

### Post-verification (required for every Phase 2 Branch A result -- work/edu only)

The person enrich API can return wrong matches: a person at the right company but not the email owner, or a person who no longer works there. Every result must pass these checks. The checks run on the `person_data` returned by the enrich script above — employers live at `experience.employment_details.current[]` / `.past[]` (each entry has `name` for the company, `title`, and `company_website_domain`).

**Check 1: Employer domain verification.** The email domain must appear in the person's current OR past employer website domains. For example, `dave@sapphireventures.com` must have `sapphireventures.com` in at least one employer's domain list. If the domain doesn't appear in any employer (current or past), REJECT the match.

```python
def verify_employer_domain(person_data, email_domain):
    domain_base = email_domain.lower().split('.')[0]
    emp_details = person_data.get("experience", {}).get("employment_details", {})
    employers = emp_details.get("current", []) + emp_details.get("past", [])
    for emp in employers:
        domains = emp.get("company_website_domain") or []
        if isinstance(domains, str):
            domains = [domains]
        for d in domains:
            if email_domain.lower() in d.lower() or d.lower() in email_domain.lower():
                return True, emp.get("name", "")
        if len(domain_base) > 3 and domain_base in emp.get("name", "").lower().replace(" ", ""):
            return True, emp.get("name", "")
    return False, None
```

**Check 2: Name-prefix match.** The email prefix must plausibly match the returned person's name. For example, `talling@lamppostgroup.com` should match a name containing "alling" (as in "Ted Alling"), not "Santosh Sankar". Check if any part of the profile name starts with the same characters as the email prefix, or if a first-initial + lastname pattern matches.

```python
def name_matches_prefix(profile_name, email_prefix):
    pn_parts = profile_name.lower().split()
    prefix = email_prefix.lower()
    for part in pn_parts:
        if prefix.startswith(part[:3]) or part.startswith(prefix[:3]):
            return True
        # First-initial + lastname pattern: "talling" = "t" + "alling"
        if len(prefix) > 2:
            for i in range(1, min(3, len(prefix))):
                if prefix[i:] in part and len(prefix[i:]) > 2:
                    return True
    return False
```

**Check 3: AI correction for name mismatches.** When the employer domain matches but the name doesn't (right company, wrong person), use web search AI mode to find who actually owns the email:

```ts
// model query: who actually owns talling@lamppostgroup.com
const r = await callTool("web_search_live", {
  query: "who is talling@lamppostgroup.com",
  sources: ["ai"],
});
const aiText = r.ok ? r.data.results?.map((x) => x.snippet || x.title).join(" ") : "";
return { aiText };
```

The AI response typically says something like "belongs to Ted Alling, Partner at Lamp Post Group". Extract the real name and search person DB (Phase 3 `person_search`) with the corrected name + company.

This step recovered 7 correct matches in testing that would otherwise have been lost.

### Expected results

- **Work/edu (Branch A):** ~58% of work+edu emails pass all verification checks. ~5% are rejected by employer domain check (wrong person entirely). ~1% are AI-corrected (right company, wrong person -> AI finds the real name).
- **Personal (Branch B):** matched directly by the async `batch_person_identify`; emails it does not match are resolved downstream via the name-based Phases 4/5, with precision gated by Phase 6.

---

## Phase 3: Person search by name + company

For work/edu emails that Phase 2 missed, try a name+company search. Extract a name guess from the email prefix and combine it with the company identified in Phase 1.

### When to use

Only for emails where:
1. Phase 2 returned no match
2. The email is work or edu (not personal)
3. The domain was identified in Phase 1 (we know the company name)
4. At least one name part can be extracted from the email prefix

### Script

The filter key is always `field`. Person-name filters on `basic_profile.name`; current-employer name filters on `experience.employment_details.current.company_name`; `limit` caps the page size.

```ts
// model query: find FirstName at CompanyName
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "FirstName" },
    { field: "experience.employment_details.current.company_name", type: "(.)", value: "CompanyName" },
  ]},
  limit: 3,
  fields: ["basic_profile", "social_handles"],   // name + profile_url
});
if (!r.ok) return { error: r.message };
// r.data.profiles[]: read basic_profile.name and
// social_handles.professional_network_identifier.profile_url
return { profiles: (r.data.profiles ?? []).map((p) => ({
  name: p.basic_profile?.name,
  profile_url: p.social_handles?.professional_network_identifier?.profile_url,
})) };
```

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

```ts
// model query: find Kyle at Backswing Ventures (email kyle@backswingventures.com)
// Name parts: ["Kyle"]; company from Phase 1 domainMap: "Backswing Ventures"
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "Kyle" },
    { field: "experience.employment_details.current.company_name", type: "(.)", value: "Backswing Ventures" },
  ]},
  limit: 3,
  fields: ["basic_profile", "social_handles"],
});
return r.ok ? { profiles: r.data.profiles } : { error: r.message };
```

Check each returned profile: does "kyle" appear in `basic_profile.name`? If yes, it's a match.

### Expected results

- Catches emails that Phase 2 missed using name + company compound search
- Works best for emails with clear name formats (john.smith@, daniel_lee@)

---

## Candidate verification (CRITICAL -- do not skip)

Without verification, name/substring matches produce false positives. For example, a search for "wraecca" might match "Alessandro Racca" because "racca" is a substring.

**For every candidate, verify ALL of the following:**

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

A search profile carries its name at `basic_profile.name`; flatten that before verifying.

```python
def verify_candidate_match(email, name_parts, profile, domain_map):
    profile_name = profile.get("basic_profile", {}).get("name", "").lower()

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

- For work/edu emails: both name AND company must verify. No company from Phase 1 = automatic reject.
- For personal emails: name match only (lower precision, but better than no verification)

---

## Phase 4: Person search by name for personal emails

Last resort for personal emails where we can extract a plausible full name from the email prefix.

### When to use

Only for emails where:
1. All previous phases returned no match
2. The email is personal (gmail, yahoo, etc.)
3. At least 2 name parts can be extracted from the email prefix

### Script

```ts
// model query: find FirstName LastName by name
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "FirstName LastName" },
  ]},
  limit: 5,
  fields: ["basic_profile", "social_handles"],
});
if (!r.ok) return { error: r.message };
return { profiles: r.data.profiles ?? [] };
```

### Acceptance criteria

- The search must return **3 or fewer results** (low ambiguity)
- If 4+ results come back, skip -- too many possible matches
- The returned name must reasonably match the extracted name parts

### How to run it

```ts
// model query: find Joanne Bradford (email joanne.bradford@gmail.com) by name
// Name parts: ["Joanne", "Bradford"]
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "Joanne Bradford" },
  ]},
  limit: 5,
  fields: ["basic_profile", "social_handles"],
});
return r.ok ? { profiles: r.data.profiles } : { error: r.message };
```

If 1-3 results returned, take the first one. If 0 or 4+, mark as unmatched.

### Expected results

- Catches remaining personal emails with clear first.last patterns
- The 3-result ceiling prevents matching the wrong person for common names
- MUST verify: both name parts from the email prefix must appear in the returned profile name. Do not just accept the first result.

---

## Phase 5: Web search fallback for all remaining unmatched emails

Final fallback for emails that all previous phases missed. Uses web search to find the person's profile URL, then enriches via that URL. This catches vanity domains (e.g., carolewainaina.com), personal brand domains, and any email not indexed in Crustdata's database.

### When to use

For any email that remains unmatched after Phases 1-5, regardless of category (work, edu, or personal).

### Step 1: Web search for profile URL

```ts
// model query: find a professional-network profile URL for EMAIL
const r = await callTool("web_search_live", {
  query: "EMAIL linkedin",
  sources: ["web"],
});
// r.data.results[]: { source, title, url, snippet, ... }
const hit = r.ok && (r.data.results ?? []).find((x) => /linkedin\.com\/in\//.test(x.url || ""));
return { profile_url: hit?.url ?? null };
```

Check the results for any URL containing `linkedin.com/in/`. If found, proceed to Step 3.

### Step 2: AI web search for name (if Step 1 didn't find a profile URL)

```ts
// model query: who owns EMAIL
const r = await callTool("web_search_live", {
  query: "who is EMAIL",
  sources: ["ai"],
});
const aiText = r.ok ? (r.data.results ?? []).map((x) => x.snippet || x.title).join(" ") : "";
return { aiText };
```

The AI response often says something like "belongs to Carole Wamuyu Wainaina" or "associated with John Smith at Company X". Extract the person's name and search the person DB:

```ts
// model query: find <Extracted Name> by name
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "Extracted Name" },
  ]},
  limit: 3,
  fields: ["basic_profile", "social_handles"],
});
// take social_handles.professional_network_identifier.profile_url off the best match
return r.ok ? { profiles: r.data.profiles } : { error: r.message };
```

If `person_search` returns a result with a profile URL (`social_handles.professional_network_identifier.profile_url`), proceed to Step 3.

### Step 3: Enrich via profile URL

```ts
// model query: enrich the resolved profile URL to get the person's details
const r = await callTool("person_enrich", {
  professional_network_profile_urls: ["PROFILE_URL_FROM_STEP_1_OR_2"],
  fields: ["basic_profile", "experience"],
});
// r.data[0].matches[0].person_data: basic_profile.name, basic_profile.headline, employers
return r.ok ? { person: r.data?.[0]?.matches?.[0]?.person_data } : { error: r.message };
```

### Expected results

- Catches vanity/personal domains (carolewainaina.com, first-last.com)
- Catches people not indexed by email but findable via web search
- The AI mode is particularly effective at resolving "who owns this email" queries

---

## Phase 6: Scoring gate (applied to all candidates from Phases 3-5)

All candidate matches produced by Phases 3, 4, and 5 must pass through this scoring gate before being accepted. Phase 2 results are exempt — Branch A has its own employer-domain + name post-verification, and Branch B matches are keyed on the email itself (the API matched the identifier directly).

### Hard requirements (both must pass)

1. **name_sim > 0.8** -- The similarity between the name extracted from the email prefix and the candidate profile name must exceed 0.8. This prevents a perfect company match from compensating for a bad name match.
2. **combined_score > 0.7** -- The overall combined score (incorporating name similarity, company match, and any other signals) must exceed 0.7.

Phase 6 requires BOTH `name_sim > 0.8` AND `combined_score > 0.7`. This prevents a perfect company match from compensating for a bad name match. For example, finding someone at the right company whose name does not resemble the email prefix will be rejected even if the company match is perfect.

### When a candidate fails

If a candidate fails the scoring gate, it is rejected and the email continues to the next phase in the waterfall. If no phase produces a candidate that passes the gate, the email is marked UNMATCHED.

---

## Scaling and concurrency

Rate limiting is handled by the host inside `execute` — there are no manual RPM tables, sleeps, or backoff to manage. For large lists, scale by fanning out work inside ONE script:

- **Batch enrich.** `person_enrich` and `company_identify` take arrays — pass up to 25 emails/domains per call. `chunk(emails, 25)` then `await parallelMap(batches, b => callTool("person_enrich", { business_emails: b, fields: [...] }))`.
- **Parallelize independent calls** with `await parallelMap(items, fn)` — never `for … await`. Keep dependent steps (search → enrich) sequential; only parallelize WITHIN a stage.
- **Return the smallest projection** — only what you `return` reaches the model.

### Optimization: deduplicate domains in Phase 1

A list of 1,000 work emails might only have 200 unique domains. Always deduplicate domains before calling `company_identify` (which takes a `domains` array — resolve all uniques in one call).

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
| `method` | Which phase found the match: `person_enrich`, `name+company`, `name_search`, `web_search` |

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
  Phase 2B (batch_identify):  {count}
  Phase 3 (name+company):     {count}
  Phase 4 (name_search):      {count}
  Phase 5 (web_search):       {count}
```

---

## Decision flowchart

```
For each email:
|
+-- Classify: work / edu / personal
|
+-- Phase 1: Is it work or edu?
|   +-- Yes -> Extract domain -> company_identify({ domains: [...] })
|   |   +-- Found company? -> Store in domain_map
|   |   +-- Not found? -> Continue (no company info for this domain)
|   +-- No (personal) -> Continue to Phase 2 Branch B
|
+-- Phase 2: Branch by email type
|   |
|   +-- Work/edu (Branch A):
|   |   +-- person_enrich({ business_emails: [email], fields: ["basic_profile","experience"] })
|   |   +-- Found person? -> Post-verify (employer domain + name prefix + AI correction)
|   |   |   +-- Verified? -> DONE (method=person_enrich)
|   |   |   +-- Failed verification? -> Continue to Phase 3
|   |   +-- Not found? -> Continue to Phase 3
|   |
|   +-- Personal (Branch B): batch_person_identify({ emails: [...] }) -> poll batch_job_get -> batch_results
|       +-- Matched? -> DONE (method=batch_identify)
|       +-- Not matched? -> Continue to Phase 4 (name search) then Phase 5 (web search)
|
+-- Phase 3: Is it work/edu AND have company name AND name parts?
|   +-- Yes -> person_search(filters: basic_profile.name + experience.employment_details.current.company_name)
|   |   +-- Found + name verified? -> Phase 6 scoring gate -> DONE (method=name+company)
|   |   +-- Not found? -> Continue to Phase 4
|   +-- No -> Skip to Phase 4
|
+-- Phase 4: Is it personal AND has 2+ name parts?
|   +-- Yes -> person_search(filters: basic_profile.name="FirstName LastName")
|   |   +-- 1-3 results returned + name verified? -> Phase 6 scoring gate -> DONE (method=name_search)
|   |   +-- 0 or 4+ results? -> Continue to Phase 5
|   +-- No -> Continue to Phase 5
|
+-- Phase 5: Still unmatched? (any email type)
|   +-- web_search_live({ query: "EMAIL linkedin", sources: ["web"] })
|   |   +-- Found linkedin.com/in/ URL? -> person_enrich({ professional_network_profile_urls: [URL] }) -> Phase 6 scoring gate -> DONE
|   +-- No URL found? -> web_search_live({ query: "who is EMAIL", sources: ["ai"] })
|   |   +-- Extracted person name? -> person_search(name) -> get profile URL -> person_enrich -> Phase 6 scoring gate -> DONE
|   +-- Nothing found? -> UNMATCHED
|
+-- Phase 6: Scoring gate (applied to all candidates from Phases 3-5)
    +-- Requires BOTH: name_sim > 0.8 AND combined_score > 0.7
    +-- Pass? -> Accept match
    +-- Fail? -> Reject, continue to next phase or mark UNMATCHED
```

---

## Key learnings

1. **Verification is non-negotiable.** In testing on 1,476 emails, strict verification removed 149 false positives that the unverified approach would have returned. Always verify.

2. **Phase 2 post-verification catches ~5% bad matches.** The person enrich API sometimes returns the wrong person at the right company (e.g., a different employee). Employer domain + name-prefix checks catch these.

3. **AI web search correction works.** When person enrich returns the right company but wrong person, `web_search_live` with `sources: ["ai"]` and query "who is EMAIL" correctly identifies the real person. Recovered 7 matches in testing.

4. **Name/substring candidates have an extremely high false positive rate without verification.** In testing: 1,540 rejections vs 37 accepts. Substring name matching produces many spurious matches. Strict name + company verification is essential.

5. **Personal-email reverse lookup is async-only.** `person_enrich` has no personal-email identifier and `person_search` has no `emails` filter `field` — the only direct path is `batch_person_identify` (submit the job, poll `batch_job_get`, read `batch_results`); emails it does not match fall back to the name-based Phases 4/5.

6. **For work/edu emails, no company = no match.** If Phase 1 didn't identify the company for a domain, do NOT accept name-search results for emails at that domain. There's nothing to verify against.

7. **Phase 4 must verify names, not just count results.** Accepting the first result just because <= 3 came back produces false positives like "Bert Zacharin" matching "Zacharie Bere". Both name parts from the email must appear in the profile name.

8. **Edu emails work with `person_enrich`.** Despite the identifier being called `business_emails`, it matches faculty and staff at universities.

9. **`person_enrich` accepts ONE identifier kind per call** — pass either `professional_network_profile_urls` OR `business_emails`, not both. Each is an array (≤25). Use `preview: true` for a 0-credit base-profile check before paying.

10. **`person_search` returns results under `r.data.profiles`** (and everything is under `r.data` first). A failed call does NOT abort the script — always branch on `r.ok` (or `unwrap`), or an unchecked failure looks like "no results".

11. **`(.)` is a literal case-insensitive substring, not a regex alternation.** A piped value like `"a|b"` matches nothing on person search — use `any_of(field, [...])` / `in_` for N values. Filter on `field`; read responses off the `Returns:` paths (e.g. `social_handles.professional_network_identifier.profile_url`, not the `experience.…` field you filter on).

12. **Phase 6 requires BOTH `name_sim > 0.8` AND `combined_score > 0.7`.** This prevents a perfect company match from compensating for a bad name match. Without the `name_sim` hard gate, false positives like "Bert Zacharin" matching "Zacharie Bere" can slip through.

---

---

# Person-to-Email Enrichment

When the input is a list of **people** (names, profile URLs, or both) and the goal is to find their **email addresses**, use this flow instead.

---

## Step 1: Resolve profile URLs

If the input already has profile URLs, skip this step.

If only names + companies are provided, resolve to profile URLs first:

```ts
// model query: resolve Person Name at Company Name to a profile URL
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    { field: "basic_profile.name", type: "(.)", value: "Person Name" },
    { field: "experience.employment_details.current.company_name", type: "(.)", value: "Company Name" },
  ]},
  limit: 3,
  fields: ["basic_profile", "social_handles"],
});
if (!r.ok) return { error: r.message };
// profile URL lives at social_handles.professional_network_identifier.profile_url
return { profile_url: r.data.profiles?.[0]?.social_handles?.professional_network_identifier?.profile_url };
```

The profile URL you need is at `social_handles.professional_network_identifier.profile_url`.

**Fallback:** If not found in the person DB, try web search:

```ts
// model query: find Person Name's profile URL on the web
const r = await callTool("web_search_live", {
  query: "Person Name Company site:linkedin.com/in/",
  sources: ["web"],
});
const hit = r.ok && (r.data.results ?? []).find((x) => /linkedin\.com\/in\//.test(x.url || ""));
return { profile_url: hit?.url ?? null };
```

Extract the profile URL from the top result.

### Common pitfalls

- **Common names**: always include company or title context. "Michael Ma Liquid 2 Ventures" not just "Michael Ma".
- **Name variants**: try both formal and common names - "William Drevno" vs "Will Drevno", "Robert" vs "Bob".
- **Recently changed roles**: search with both old and new company if you know them.

---

## Step 2: Enrich business emails

`professional_network_profile_urls` is an ARRAY (≤25 per call). Request the `contact` field group to get business emails — they are not returned by default.

```ts
// model query: get business emails for these profile URLs
const r = await callTool("person_enrich", {
  professional_network_profile_urls: profileUrlBatch,   // ≤25 URLs
  fields: ["basic_profile", "contact"],                 // name + business_emails
});
if (!r.ok) return { error: r.message };
// r.data is an ARRAY of { matched_on, matches: [{ person_data }] }; map back via matched_on
return { results: r.data.map((rec) => ({
  profile_url: rec.matched_on,
  name: rec.matches?.[0]?.person_data?.basic_profile?.name,
  business_emails: (rec.matches?.[0]?.person_data?.contact?.business_emails ?? []).map((b) => b.email),
})) };
```

### Critical details

- `professional_network_profile_urls` takes up to **25 profile URLs per call** (an array)
- Business emails come back in the `contact` field group (`contact.business_emails[].email`) — request `contact` in `fields`
- Pass ONE identifier kind per call — `professional_network_profile_urls` here
- The response is an array. Map results back to input URLs using each record's `matched_on` field.

### Handling large lists

For 25+ profiles, `chunk(profileUrls, 25)` then fan out: `await parallelMap(batches, b => callTool("person_enrich", { professional_network_profile_urls: b, fields: ["basic_profile", "contact"] }))`. `return` only the projected `{ profile_url, name, business_emails }` to stay under token limits.

---

## Step 3: Enrich personal emails and phone numbers

The `contact` field group returns `business_emails`, `personal_emails`, AND `phone_numbers` — request it to get personal contact info. Use `preview: true` first (0 credits) to check whether a profile has personal contact data before paying for it. `preview: true` is account-gated: if it returns a 400 "Preview feature is not available for your account", your account lacks preview — skip it and enrich directly (you pay base credits).

```ts
// model query: get personal emails and phone numbers for these profiles
const r = await callTool("person_enrich", {
  professional_network_profile_urls: profileUrlBatch,   // ≤25 URLs
  fields: ["basic_profile", "contact"],                 // personal_emails + phone_numbers
});
if (!r.ok) return { error: r.message };
return { results: r.data.map((rec) => {
  const c = rec.matches?.[0]?.person_data?.contact ?? {};
  return {
    profile_url: rec.matched_on,
    personal_emails: (c.personal_emails ?? []).map((e) => e.email ?? e),
    phone_numbers: c.phone_numbers ?? [],
  };
}) };
```

### Credit usage

`person_enrich` cost is **additive** per add-on: base **1**, **+1** business email, **+2** personal email, **+2** phone number, **+1** dev-platform — **capped at 7**. `preview: true` is **0** credits. So a profile with business email = 2 cr; with personal email + phone = 5 cr. Default to business email for outreach; request personal/phone only when the task needs them.

### Access

Personal contact info enrichment is access-controlled. Not all accounts have it enabled. If `personal_emails` / `phone_numbers` come back empty, the account may need this feature turned on (preview is a cheap way to check first).

### Combining with business email

The `contact` group already returns business, personal, and phone in one call, so you get everything together:

```ts
// model query: get business + personal emails + phone for one profile
const r = await callTool("person_enrich", {
  professional_network_profile_urls: ["https://linkedin.com/in/person1"],
  fields: ["basic_profile", "contact"],
});
return r.ok ? { contact: r.data?.[0]?.matches?.[0]?.person_data?.contact } : { error: r.message };
```

---

## Step 4: GitHub fallback for personal emails (technical people)

If personal contact info enrichment is not available or returns empty for technical people, fall back to GitHub commit history. This only works for engineers, developers, and technical founders.

### Find their GitHub username

Check the person record first: `social_handles` carries a `dev_platform_identifier` (the person's GitHub handle) alongside the professional-network one, and adding `dev_platform_profiles` to `person_enrich`'s `fields` (the dev add-on, +1 credit) returns the full GitHub profile — repos, org memberships, `all_languages`, and sometimes a public `email` — in the same call as the profile. For a person you resolved without those groups, use standalone `dev_platform_enrich`. Pass EXACTLY ONE of `crustdata_person_id` — every match row from earlier phases carries it as `person_data.crustdata_person_id`, so use this for a person you already resolved — or `profile_url`, which must be a **GitHub** URL (`https://github.com/<username>`); a LinkedIn URL here is rejected with a 400. It returns `dev_platform_profiles[]` with `profile_url`, `name`, `bio`, `company_text`, and sometimes a public `email`:

```ts
// model query: find this person's GitHub profile (and any public email)
const r = await callTool("dev_platform_enrich", {
  crustdata_person_id: PERSON_ID_FROM_EARLIER_PHASE, // person_data.crustdata_person_id
});
if (!r.ok) return { error: r.message };
// r.data.dev_platform_profiles[]: { profile_url, name, bio, company_text, email, ... }
return { github: r.data.dev_platform_profiles ?? [] };
```

Or search the web:

```ts
// model query: find Person Name's GitHub profile
const r = await callTool("web_search_live", {
  query: "Person Name Company site:github.com",
  sources: ["web"],
});
return r.ok ? { results: r.data.results } : { error: r.message };
```

### Verify the GitHub profile

Confirm at least 2 of these match: GitHub bio mentions their company/role, profile name matches, repo topics align with their expertise. `dev_platform_enrich` returns `name`, `bio`, and `company_text` to check against. If `dev_platform_profiles[].email` is already populated and is not a noreply address, you can use it directly and skip the commit-scraping below.

### Extract email from commits

The `dev_platform_profiles[].repos` entries already carry what you need to pick a target — `full_name`, `is_fork`, and `github_created_at`. Choose the oldest repo where `is_fork` is false; no extra call needed. Only if the enrichment returned no repos, list them with `web_enrich_live` (the `urls` param is an ARRAY):

```ts
// model query: list the user's oldest repos to find a non-fork repo
const r = await callTool("web_enrich_live", {
  urls: ["https://api.github.com/users/USERNAME/repos?sort=created&direction=asc&per_page=5"],
});
// r.data is [{ success, url, title, content }]; parse content[0] for repo names
return r.ok ? { content: r.data?.[0]?.content } : { error: r.message };
```

Then fetch the commit email:

```ts
// model query: read the commit patch to extract the author email
const r = await callTool("web_enrich_live", {
  urls: ["https://github.com/OWNER/REPO/commit/SHA.patch"],
});
return r.ok ? { content: r.data?.[0]?.content } : { error: r.message };
```

Extract the email from the `From:` header in the patch. Discard `noreply@github.com` and `*@users.noreply.github.com` addresses.

---

## Person-to-email expected results

- **Business emails**: 95%+ of professionals at known companies
- **Personal emails**: 95%+ via enrichment API with personal contact info enabled
- **Phone numbers**: 95%+ via enrichment API with personal contact info enabled

---

## Crustdata tool reference

All tools are reached via `callTool("<tool>", params)` inside an `execute({ code })` script.

| Tool | Purpose | Key parameters |
|------|---------|---------------|
| `company_identify` | Domain to company (FREE) | `domains: [...]` (array), `names`, optional `exact_match` |
| `person_enrich` | Email to person, or profile URL to emails | ONE of `business_emails: [...]` OR `professional_network_profile_urls: [...]`; `fields: [...]` (groups: `basic_profile`, `contact`, `experience`, …); `preview: true` (0 cr) |
| `person_search` | Search people by filters | `filters` (`{ op, conditions: [{ field, type, value }] }`), `limit`, `cursor`, `fields` |
| `web_search_live` | Web search (find profiles, AI "who is" lookups) | `query`, `sources` (e.g. `["web"]`, `["ai"]`) |
| `web_enrich_live` | Fetch page content (GitHub commits) | `urls: [...]` (array) |
| `dev_platform_enrich` | GitHub/dev-platform profile (technical people) | `profile_url` or `crustdata_person_id` |

MCP server: `install.crustdata.com/mcp` (Code Mode — meta-tools `list_tools`, `get_schema`, `execute`).

---

## Tool dependencies

This skill requires the **Crustdata Code Mode MCP server** connected at [install.crustdata.com/mcp](https://install.crustdata.com/mcp). It exposes the meta-tools `list_tools`, `get_schema`, and `execute`; data tools are called via `callTool(...)` inside an `execute` script. The data tools this skill uses:
- `company_identify`
- `person_enrich` (and `person_enrich_live` for real-time profile-URL enrichment)
- `person_search`
- `web_search_live`
- `web_enrich_live`
- `dev_platform_enrich`
