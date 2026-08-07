# Dossier schema (one per account)

`build_workspace.py` reads one dossier JSON per account and injects it into the template.
Write one file per account to `<WORK>/<slug>/dossier.json`.

Everything is optional except `account.name` and `stakeholders` - missing keys degrade
gracefully to empty sections rather than breaking the page. But a dossier with no
`priorities`/`opener`/`linkedin_summary` produces a workspace that looks impressive and
says nothing, which is worse than useless to someone about to send a real email. Fill them.

## Top level

```jsonc
{
  "meta": {
    "generated_at": "2026-07-23",
    "seller": {"name": "Acme", "domain": "acme.com"},
    "product_one_liner": "what you sell, one sentence",
    "deal_stage": "Prospecting",
    "run_id": "..."
  },
  "account": { ... },
  "stakeholders": [ ... ],
  "signals": [ ... ],
  "plays": [ ... ],
  "gaps": ["what you could not verify"]
}
```

Do **not** hand-write `graph` or `warm_paths` - `build_workspace.py` computes both from the
connections file and overwrites whatever is there.

## `account`

```jsonc
{
  "name": "Acme", "domain": "acme.com", "linkedin_url": "...", "logo_url": "data:image/jpeg;base64,...",
  "one_liner": "...", "industry": "...", "hq": "...", "founded": 1999,
  "headcount": 12000, "headcount_range": "10001+", "headcount_growth_pct_12mo": 4.2,
  "estimated_revenue": null, "total_funding_usd": null,
  "last_round": {"type": "Series F", "date": "2025-03-01"},
  "investors": ["..."], "stock_symbol": "ACME", "competitors": ["..."],
  "brief": "3-4 sentences: what they do, scale, what is changing, why now",
  "brief_evidence": [{"source": "company_enrich", "detail": "headcount 12,000, +4.2% yoy"}],
  "hiring_signal": {
    "open_roles_total": 812,
    "by_function": [{"function": "Engineering", "count": 401}],
    "surge_note": "one line on what the hiring mix implies",
    "surge_evidence": [{"source": "job_search group_by", "detail": "..."}],
    "notable_roles": [{"title": "...", "location": "...", "url": "..."}]
  },
  "recent_activity": [{"date": "2026-07-01", "type": "news|post", "title": "...", "url": "..."}]
}
```

## `stakeholders[]`

One per buying-group member. `id` is referenced by the graph, so keep it stable.

```jsonc
{
  "id": "s1",
  "name": "...", "title": "...", "linkedin_url": "...",
  "seniority": "Director", "function": "Talent Acquisition",
  "tenure_years": 2.7, "location": "...",
  "entity": "Acme",              // sub-brand/acquired unit if they sit in one; enables same-unit routing
  "deal_role": "Economic Buyer", // Economic Buyer | Champion | Technical Buyer | Influencer | Blocker | End User | Unknown
  "engagement": "Not contacted", // Not contacted | Cold | Engaged | Champion | Detractor
  "influence": 4,                // 1-5
  "email": null, "phone": null, "twitter_handle": null,
  "photo_url": "data:image/jpeg;base64,...",   // see "Logos and photos are free" below

  "summary": "who they are and why they matter to this deal",
  "summary_evidence": [{"source": "person_enrich", "detail": "..."}],
  "linkedin_summary": "a paragraph synthesising the post read - the headline output",
  "priorities":       [{"text": "...", "evidence": [{"source": "post 2026-05-02", "detail": "..."}]}],
  "talking_points":   [{"text": "...", "evidence": [...]}],
  "likely_objections":[{"text": "...", "evidence": [...]}],
  "buying_signals":   [{"text": "...", "evidence": [...]}],
  "opener": "one or two sentences that paraphrase something real they said or own",
  "opener_evidence": {"source": "post 2026-05-02", "detail": "..."},
  "posting_themes": [{"theme": "...", "weight": 0.35, "example": "..."}],
  "notable_posts": [{"date": "...", "excerpt": "...", "url": "...",
                     "signal": "buying_intent|hiring|thought_leadership|job_change|personal"}],
  "career": [{"company": "...", "title": "...", "start": "2021-01-01", "end": null}],
  "education": [{"school": "...", "degree": "...", "field": "..."}],
  "posts_analyzed": 47,
  "data_sources": ["person_enrich", "posts:47", "contact_enrich"],
  "gaps": ["what was thin or unverified for this person"]
}
```

### Logos and photos are free - use them

The workspace renders the account logo in its header and the account switcher, and a photo on
every stakeholder card and drawer. Both come from calls the run already makes, so they cost
**no extra credits**:

- **Account logo** - `basic_info.logo_permalink`, returned by `company_identify` (free) and by
  the Phase 1 `company_enrich` you already pay for.
- **Stakeholder photo** - `basic_profile.profile_picture_permalink`, already inside the
  `basic_profile` group that `person_search` and `person_enrich` return.

**Both MUST be base64 data-URIs in the dossier, not URLs.** The media CDN serves these files as
`binary/octet-stream`, which browsers refuse to render as images, so a remote `<img src>` shows
blank even though the URL fetches fine. Download the permalink, base64 it, and write
`data:image/jpeg;base64,...` into `logo_url` / `photo_url`. That also keeps the workspace a
genuinely self-contained file. Omit the field when there is no image - the renderer falls back
to a monogram, and a broken image falls back at runtime too.

### The evidence convention

`priorities`, `talking_points`, `likely_objections`, `buying_signals` are `{text, evidence}`
objects; `summary` and `opener` get sibling `summary_evidence` / `opener_evidence`. Evidence
is a string, a list of strings, or a list of `{source, detail}`. The renderer turns these
into an "evidence" dropdown next to each claim.

This is the mechanism that keeps the artifact trustworthy: a reader can click any assertion
and see the exact payload it came from. If a claim has no evidence, either find the evidence
or drop the claim - an unfalsifiable dossier is what makes people stop believing the tool.

## `signals[]` and `plays[]`

```jsonc
"signals": [{"date": "2026-07-01", "type": "hiring|intent|job_change|funding|news|post",
             "text": "...", "severity": "high|medium|low",
             "stakeholder_id": "s3", "evidence": [...]}]

"plays":   [{"title": "...", "why": "cite the signal or gap", "action": "who, via which path, with what angle",
             "priority": "high|medium|low", "evidence": [...]}]
```

Plays are where the warm paths earn their keep: name the connection and the decision maker,
not "reach out to the team".
