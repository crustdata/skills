---
name: sales-prospecting
description: >
  Prospecting hub. Opens by asking your GOAL, then routes to 7 sub-skills - find new
  companies, lookalikes of best customers, rank my accounts, event prospecting,
  expansion radar, TAM builder, champion tracker (with live watcher). Iterative
  Crustdata search, FIT x TIMING x WARMTH scoring, opt-in enrichment, handoff to
  sheet or CSV. Use for "build me a list", "find companies like <customer>", "who
  should I prospect", "rank my accounts", "who's hot in my book", "list for
  <conference>", "upsell targets", "how big is this market", "track champions who
  leave customers".
---

# Sales Prospecting

The prospecting hub. **Always open with: "What's your goal?"** and show the 7 sub-skills. Route, then run that sub-skill's recipe exactly. Every recipe below was live-tested — follow it, including the gotchas.

## Step 0: context (never blocks)

- If `config/gtm-config.md` or `config/persona-profile.md` exist in the working directory, read them for ICP, what you sell, buyer titles, customer list, and stack.
- If they don't exist, ask 1-2 quick questions inline ("Who do you sell to — industry, size, geo? Which titles buy?") or point the user at the **icp-builder** skill to build the config properly. A missing config must never block a run.
- Confirm the ask in one line before spending credits.

---

## THE GOAL MENU (show this first)

1. **Find new companies** — "I have an ICP, build me a fresh list"
2. **Lookalikes** — "find companies like my best customers"
3. **Rank my accounts** — "here are my accounts (book / territory / CSV) — who do I work first?"
4. **Event prospecting** — "who's at <conference> that I should meet?"
5. **Expansion radar** — "where can I grow inside my existing customers?"
6. **TAM builder** — "how big is my market, with real numbers?"
7. **Champion tracker** — "alert me when champions leave my customers" (live watcher)

---

## HOW EVERY SEARCH RUNS (Code Mode ground rules)

All Crustdata data tools run inside `execute({ code })` — a **plain-JavaScript script** (author against the typed surface from `get_schema`, but write zero type annotations; a `: Type`, `as`, or generic is a parse error that fails the whole run before any spend).

- **Every script opens with a query comment** — `// user query: ...` for the user's literal ask, `// model query: ...` for a derived step. Scripts without one are rejected before running.
- **One I/O primitive**: `const r = await callTool(name, params)` returns `{ ok: true, data }` or `{ ok: false, status, errorType, message }`. **Always branch on `r.ok`** — a failed call does not abort the script, so an unchecked failure silently proceeds on empty data and looks like "no results".
- **`fields` is a response whitelist.** The result carries only the groups/paths you list; an omitted group reads as `undefined` later and looks like missing data. List every group you read.
- **Return the smallest projection.** Only what the script returns reaches the model — map to name/id/url/signal rows, never raw profiles.
- **Fan out independent calls** with `await parallelMap(items, fn)`; batch first with `chunk(list, 25)`. Never parallelize cursor pagination or dependent stages. `checkpoint(acc)` after costly stages so a timeout returns partial progress.
- **Categorical values are closed sets.** A plausible-but-wrong value silently returns zero rows. Resolve exact stored values with `company_autocomplete` / `person_autocomplete` (free) before filtering: `basic_info.industries`, `taxonomy.professional_network_industry`, `funding.last_round_type`, `basic_info.company_type`, titles, seniority, function_category.
- **Seniority vocabulary** (person_search): `Entry Level`, `Entry Level Manager`, `Experienced Manager`, `Senior`, `Director`, `Vice President`, `CXO`, `Owner / Partner`, `In Training`, `Strategic`. Always confirm via `person_autocomplete` before filtering.
- **Plan-gated projections fail the whole call with a 403** that names the field — drop it and re-run. Known: `professional_network.followers` and `metadata` on person_search. Never project followers; filter on `professional_network.connections` instead (`gte(..., 100)` works).
- **Filter paths ≠ response paths** (person_search): filter `...current.company_name` → returns under `...current[].name`; filter `...current.company_id` → returns under `...current[].crustdata_company_id`; filter `...current.company_website_domain` → returns under `...current[].company_website`. The LinkedIn URL returns at `social_handles.professional_network_identifier.profile_url` (use the `profileUrl(p)` accessor) and is not filterable.
- **Value formats**: company `locations.country` accepts ISO-3 (`USA`) as a *filter* but **returns** the normalized full name — don't compare a response value against `"USA"`. Employer HQ country is ISO-3; person `basic_profile.location.country` is the full name (`United States`); domains are bare (`stripe.com`); funding stages are lowercase snake_case (`series_a` — `in`/`not_in` match the exact stored string, `=` is case-insensitive).
- **Nested-array AND (person_search)**: a plain `and_` over one nested-array field (`experience.*`) means **one array element must satisfy every condition** — so "an Engineer *at* company X" is the default and works. For **cross-element** ("was an Engineer at A *and* a Manager at B", two different jobs) a plain `and_` returns nothing; use the `all_of` group instead. The query builder has no `all_of` helper, so write the raw filter object: `{ op: "all_of", conditions: [ {...}, {...} ] }`. For several required values on one field, `has_all` does the same thing.
- **Zero results ≠ no matches.** A well-formed query can encode an ill-posed ask. Decompose, test each predicate's selectivity with cheap counts, and read the `trajectory` (per-call filters + counts) in the execute response before trusting multi-step results.
- **Dedup across rounds** with `post_processing: { exclude_profiles: [...], exclude_names: [...] }` on person_search.

---

## SUB-SKILL RECIPES

### 1. Find new companies (net-new)

Intake: ICP (industry/size/geo/stage) + **signals** (palette below) + target titles + rows wanted.

**Step 1 — validate every categorical via autocomplete.** Wrong value = silent zero.

```js
// model query: resolve exact industry and funding-stage values before filtering
const probes = [
  ["basic_info.industries", "software"],
  ["funding.last_round_type", "series a"],
];
const values = await parallelMap(probes, async ([field, query]) => {
  const r = await callTool("company_autocomplete", { field, query });
  return { field, values: r.ok ? r.data : r.message };
});
return values;
```

**Step 2 — broad `company_search`, then inspect top 10 and refine 2-4 rounds.** Refinement levers: stage lock (`funding.last_round_type`), amount band (`funding.total_investment_usd`, `funding.last_round_amount_usd`), `basic_info.year_founded`, growth floor `gt("headcount.growth_percent.12m", N)` — filterable but **not sortable**; to rank by growth, filter on it and sort on `headcount.total` or `funding.last_fundraise_date`. Report what each round caught and dropped.

```js
// model query: US software companies 51-1000, raised $5M+, growing >20% — refine round 2
const r = await callTool("company_search", {
  filters: and_(
    in_("basic_info.industries", ["Software Development"]),
    eq("locations.country", "USA"),
    between("headcount.total", 51, 1000),
    gt("funding.total_investment_usd", 5000000),
    gt("headcount.growth_percent.12m", 20)
  ),
  fields: ["crustdata_company_id", "basic_info", "headcount", "funding"],
  sorts: [{ field: "funding.last_fundraise_date", order: "desc" }],
  limit: 25,
});
if (!r.ok) return { error: r.message };
return {
  total: r.data.total_count,
  rows: r.data.companies.map(c => ({
    id: c.crustdata_company_id,
    name: c.basic_info?.name,
    domain: c.basic_info?.primary_domain,
    hc: c.headcount?.total,
    growth12m: c.headcount?.growth_percent?.["12m"],
    lastRound: c.funding?.last_round_type,
    lastRaise: c.funding?.last_fundraise_date,
  })),
};
```

**Step 3 — people pull.** One `person_search` scoped to the shortlisted company ids + target titles/seniority (resolve seniority values via `person_autocomplete` first). Junk filter in the same query: connections floor, advisor/investor exclusion (`excludes()` builds one fuzzy negation per value — AND several).

```js
// model query: buyer-title people at the shortlisted companies
const r = await callTool("person_search", {
  filters: and_(
    in_("experience.employment_details.current.company_id", inputs.ids),
    in_("experience.employment_details.current.seniority_level", ["Director", "Vice President", "CXO"]),
    gte("professional_network.connections", 100),
    excludes("experience.employment_details.current.title", "advisor"),
    excludes("experience.employment_details.current.title", "investor")
  ),
  fields: ["basic_profile", "experience", "social_handles"],
  limit: 50,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => ({
  name: p.basic_profile?.name,
  title: p.basic_profile?.current_title,
  company: p.experience?.employment_details?.current?.[0]?.name,
  url: profileUrl(p),
}));
```

**Step 4 — score FIT x TIMING x WARMTH** → 🔥/🟡/⚪ with the driving signal + its date shown on every row. Free data only; contact enrichment stays opt-in (see universal rules).

### 2. Lookalikes

1. `company_identify` the seed customers — free; **one identifier type per call** (`domains` OR `names`, as arrays). Identify is fuzzy: one domain can match several companies — pick the top `confidence_score` match per identifier.
2. ONE `company_search` with `in_("crustdata_company_id", seedIds)` to read their shared traits (industry values, size band, stage, growth, geo).

```js
// model query: resolve seed customers and read the traits they share
const idr = await callTool("company_identify", {
  domains: inputs.seedDomains,
  fields: ["crustdata_company_id", "basic_info"],
});
if (!idr.ok) return { error: idr.message };
const ids = idr.data
  .map(m => m.matches?.[0]?.company_data?.crustdata_company_id)
  .filter(Boolean);
const r = await callTool("company_search", {
  filters: in_("crustdata_company_id", ids),
  fields: ["crustdata_company_id", "basic_info", "headcount", "funding", "taxonomy", "locations"],
  limit: ids.length,
});
if (!r.ok) return { error: r.message };
return r.data.companies.map(c => ({
  name: c.basic_info?.name,
  industries: c.basic_info?.industries,
  hc: c.headcount?.total,
  growth12m: c.headcount?.growth_percent?.["12m"],
  stage: c.funding?.last_round_type,
  country: c.locations?.country,
}));
```

3. Those shared traits become the filters → run recipe 1 from step 2. Exclude the seeds and existing customers with `nin_("crustdata_company_id", excludeIds)`.

### 3. Rank my accounts (book, territory, or pasted CSV — one sub-skill)

Input: account names/domains/CSV from anywhere.

1. Resolve ALL rows via `company_identify` (free; batch with `chunk(domains, 25)` + `parallelMap`; one identifier type per call). **Flag unresolved rows honestly** — never silently drop them. Fuzzy matches multiply; pick top `confidence_score` per row.
2. ONE `company_search` with `in_("crustdata_company_id", ids)`, `fields: ["crustdata_company_id", "basic_info", "funding", "headcount"]`. Growth returns inside the `headcount` group (`headcount.growth_percent.{1m,3m,6m,12m}`) — no extra call needed. Remember `fields` is a whitelist: list every group you read.

```js
// user query: rank my account list — who do I work first?
const batches = chunk(inputs.domains, 25);
const identified = await parallelMap(batches, async (batch) => {
  const r = await callTool("company_identify", {
    domains: batch,
    fields: ["crustdata_company_id", "basic_info"],
  });
  return r.ok ? r.data : batch.map(d => ({ matched_on: d, matches: [], error: r.message }));
});
const rows = identified.flat();
const unresolved = rows.filter(m => !m.matches?.length).map(m => m.matched_on);
const ids = rows.map(m => m.matches?.[0]?.company_data?.crustdata_company_id).filter(Boolean);
checkpoint({ ids, unresolved });
const r = await callTool("company_search", {
  filters: in_("crustdata_company_id", ids),
  fields: ["crustdata_company_id", "basic_info", "funding", "headcount"],
  limit: ids.length,
});
if (!r.ok) return { error: r.message, unresolved };
return {
  unresolved,
  accounts: r.data.companies.map(c => ({
    id: c.crustdata_company_id,
    name: c.basic_info?.name,
    lastRound: c.funding?.last_round_type,
    lastRaise: c.funding?.last_fundraise_date,
    raisedUsd: c.funding?.total_investment_usd,
    hc: c.headcount?.total,
    growth3m: c.headcount?.growth_percent?.["3m"],
    growth12m: c.headcount?.growth_percent?.["12m"],
  })),
};
```

3. Optional depth per hot account: `job_search` with `aggregations` + `limit: 0` for open-role counts (cheap hiring signal — see expansion radar for the snippet).
4. Score: TIMING-weighted. Funding <3mo = 🔥; 3-9mo = 🟡; >12mo = ⚪; headcount growth or a hiring surge bumps a tier. Output: ranked table + "why" per row + this week's top 5.

### 4. Event prospecting

1. **Source the roster for real — never invent attendees.** `web_search_live` for "<event> sponsors exhibitors" (the official /sponsors page usually lists tiers right in the snippet), then `web_enrich_live` the page for the full list. Rep-provided lists welcome.

```js
// model query: find the official sponsor page for the event and pull the roster
const s = await callTool("web_search_live", { query: `${inputs.event} sponsors exhibitors` });
if (!s.ok) return { error: s.message };
const page = s.data.results.find(x => /sponsor|exhibitor/i.test(x.url));
if (!page) return { candidates: s.data.results.map(x => ({ title: x.title, url: x.url })) };
const f = await callTool("web_enrich_live", { urls: [page.url] });
if (!f.ok) return { error: f.message };
return { url: page.url, page: f.data };
```

2. `company_identify` the roster (free, `chunk(25)` + `parallelMap`) → one scoped `company_search` to filter to ICP → people via recipe 1 step 3. Prefer people already posting about the event: `social_post_search_live` on the event name — 1 credit per post (3 with `exact_keyword_match`), so set `limit` deliberately (10-20).
3. Deliverable: meet-list ranked by ICP fit, with booth/tier + a suggested opener referencing the event (write it under the no-slop rule below).

### 5. Expansion radar (revenue hiding in plain sight)

Input: customer list (CRM export or rep-provided). Sweep FOUR expansion surfaces — three scoped searches cover the whole book, not one call per account:

- **New money** — the rank-my-accounts scoped `company_search` (funding fields): fresh raise = budget.
- **New people** — ONE `person_search` with `in_("experience.employment_details.current.company_id", customerIds)` + senior levels; read `current[].start_date` and keep the last ~6 months. A new exec in the function you sell to is the single best expansion trigger. Also: `job_search` openings (below).
- **New ground** — teams/geos/functions you don't touch yet: same scoped `person_search` grouped by `function_category` / region in-script, compared against where your current contacts sit.
- **Warm paths** — your champions there + who they can intro (the referral ask, scripted). Feed from the config customer list and champion-tracker output.

```js
// model query: new senior hires in the last 6 months across customer accounts
const cutoff = new Date(Date.now() - 183 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const r = await callTool("person_search", {
  filters: and_(
    in_("experience.employment_details.current.company_id", inputs.customerIds),
    in_("experience.employment_details.current.seniority_level", ["Director", "Vice President", "CXO"])
  ),
  fields: ["basic_profile", "experience", "social_handles"],
  limit: 100,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => {
  const cur = p.experience?.employment_details?.current?.[0];
  return {
    name: p.basic_profile?.name,
    title: cur?.title,
    company: cur?.name,
    started: cur?.start_date,
    url: profileUrl(p),
  };
}).filter(x => x.started && x.started >= cutoff);
```

```js
// model query: open-role counts per customer account (hiring signal, counts only)
const r = await callTool("job_search", {
  filters: in_("company.basic_info.company_id", inputs.customerIds),
  aggregations: [{ type: "group_by", field: "company.basic_info.crustdata_company_id", agg: "count", size: 100 }],
  limit: 0,
});
if (!r.ok) return { error: r.message };
return r.data.aggregations;
```

Tech-stack detection in postings: filter `content.description` with `[.]` (exact token) for a brand/product/tech name — `(.)` is typo-tolerant and matches lookalike words, so keep it only for descriptive multi-word matching. Sort postings by `metadata.date_added` for freshness.

Output per customer: opportunity — surface — evidence (dated) — estimated size (seats/teams) — the warm path in — suggested play. Rank the whole book by expansion-readiness.

### 6. TAM builder (researched methodology — do it properly)

Bottom-up with real company counts beats top-down guessing (count actual companies x ACV). Build THREE layers, each = one `company_search` count query: **`limit: 1`, read `total_count`, ~0.03 credits each** — cheap enough to run every breakdown you want. Note: `company_search` has no `count` parameter; `limit: 1` + `total_count` IS the count query. (`person_search` does have `count`, mutually exclusive with `limit`.)

- **TAM** — broadest qualifying definition (anyone who could ever buy). Tested example: US "Software Development", headcount 51-1000 = **8,244**.
- **SAM** — what your product/GTM serves today (add funding/stage/geo constraints). Tested: + raised $5M+ = **3,132**. (+ growth >20%/12m narrows to **1,245** — a useful "SAM, growing" cut.)
- **SOM** — realistically winnable: SAM x a credible win-rate %, or capacity (reps x deals/yr).

```js
// user query: how big is my market — TAM/SAM with real counts
const base = [
  in_("basic_info.industries", ["Software Development"]),
  eq("locations.country", "USA"),
  between("headcount.total", 51, 1000),
];
const layers = [
  { name: "TAM", extra: [] },
  { name: "SAM", extra: [gt("funding.total_investment_usd", 5000000)] },
  { name: "SAM-growing", extra: [gt("funding.total_investment_usd", 5000000), gt("headcount.growth_percent.12m", 20)] },
];
const counts = await parallelMap(layers, async (l) => {
  const r = await callTool("company_search", {
    filters: and_(...base, ...l.extra),
    fields: ["crustdata_company_id"],
    limit: 1,
  });
  return { layer: l.name, count: r.ok ? r.data.total_count : null, error: r.ok ? undefined : r.message };
});
return counts;
```

Then: **$ = counts x ACV** (ACV from config or the rep). Cross-check top-down: `web_search_live` for analyst market-size figures and show both numbers side by side. **State your filters** — always print the exact filter set behind each count so the number is defensible. Offer breakdowns (by size band / geo / stage) as extra count queries; at ~0.03 credits each, run them freely via `parallelMap`.

### 7. Champion tracker (list now + watcher forever)

**Step 1 — the list today.** `person_search` with past employer + `recently_changed_jobs`:

```js
// user query: champions who recently left my customer accounts
const r = await callTool("person_search", {
  filters: and_(
    in_("experience.employment_details.past.company_website_domain", inputs.customerDomains),
    eq("recently_changed_jobs", true),
    gte("professional_network.connections", 100),
    excludes("experience.employment_details.past.title", "advisor"),
    excludes("experience.employment_details.past.title", "investor"),
    excludes("experience.employment_details.past.title", "board")
  ),
  fields: ["basic_profile", "experience", "social_handles"],
  limit: 50,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => {
  const cur = p.experience?.employment_details?.current?.[0];
  const past = p.experience?.employment_details?.past?.[0];
  return {
    name: p.basic_profile?.name,
    was: past?.title,
    at: past?.name,
    now: cur?.title,
    nowAt: cur?.name,
    landed: cur?.start_date,
    url: profileUrl(p),
  };
});
```

**Gotchas (all live-tested):**
- `experience.employment_details.past.end_date` is NOT filterable — don't try. The supported recipe is past employer + `recently_changed_jobs = true`, then read `current[].start_date` and curate.
- **The raw list is noisy — read the rows and drop:** internal movers whose "new" company is still the customer (or its rebrand); subsidiary/acquisition moves (the entity was renamed or absorbed, nobody actually left); advisors/investors/LPs whose stint ended long ago; stale alumni whose recent job change has nothing to do with the customer — confirm the customer was their most recent employer before pitching "congrats".
- `excludes()` catches most advisor/investor titles up front; one value per condition, AND several. Reading the rows catches the rest.
- The new company reads from `current[].name` (you filter on `company_name`; the response key is `name`).
- Keep the connections floor; never project followers.

**Step 2 — the watcher (keeps it running).** Watchers are plain REST, not Code Mode. The Person Discovery Watcher turns **exactly the filters you just validated** into a continuous feed that delivers only NEW matches per run, weekly, to a webhook of your choice. First run = free baseline (up to 5 matches), then **0.5 credits per new person**.

Process: run the Step 1 search first and confirm the list looks right with the user → build the curl with the SAME filters → show it → **create only on an explicit yes**.

```bash
curl -X POST https://api.crustdata.com/watch/person/search \
  -H "authorization: Bearer YOUR_API_KEY" \
  -H "x-api-version: 2025-11-01" \
  -H "content-type: application/json" \
  -d '{
    "filters": {
      "op": "and",
      "conditions": [
        { "field": "experience.employment_details.past.company_website_domain", "type": "in", "value": ["customer1.com", "customer2.com"] },
        { "field": "recently_changed_jobs", "type": "=", "value": true }
      ]
    },
    "config": { "trigger": { "type": "interval", "every_hours": 168 } },
    "notifications": [{ "type": "webhook", "url": "https://your-endpoint.example.com/champions" }]
  }'
```

**Step 3 — output rows:** Person — was [role] at [customer] — now [title] at [new company] — landed [date]. Hand off to your outreach tooling for the "congrats, you know us" touch.

---

## SIGNAL PALETTE (offer during intake, composable)

Growth (headcount %, role-mix growth, revenue band) — Funding (recency, stage, size, investors) — Hiring (the role whose pain you solve, posting surge, tech named in job posts via `content.description` `[.]`) — Content & intent (people/company posting a keyword via `social_post_search_live`, competitor mentions) — People & movement (champion moved, new exec, competitor leavers, customer alumni, same school) — Company events (news, launches, new office via `web_search_live`) — Tech & presence (technographics, software review counts/ratings) — Warmth (mutuals, shared investor, accelerator) — Disqualifiers OUT (layoffs, existing customers, competitors) — Custom AND-rules.

## UNIVERSAL RULES

- Ask the goal first; confirm scope in one line; then run the recipe, narrating steps.
- **Iterate, never dump round-1 results.** Show what each refine round dropped and why.
- **Free data first.** Contact enrichment is opt-in and cost-confirmed before running. `person_contact_enrich` is the default for contact info: no base charge, roughly +1 credit business email, +2 personal email, +2 phone, capped at 5 per person; ≤25 URLs per call (`chunk` + `parallelMap`). Narrow `fields` to cap the spend and read `credits_remaining` for the actual figure. Always quote the ceiling first: "emails for 20 people = at most ~100 credits, go?"
- Company enrich (2 credits per returned match, +2 per match if technographics is requested and returned — so 2-4 cr/match) only by `crustdata_company_ids` + `exact_match: true`, after a free identify.
- **Junk filter always:** <100 connections, placeholder headlines, advisors/investors/board, geo/role mismatches.
- Watchers and any external write need an explicit yes.
- **Handoff (always ask):** a spreadsheet — CSV export (for your sequencer or CRM import) — hand to the **account-research** skill for deep-dives on the top accounts — or table only.
- **Any text you draft** (openers, plays, referral scripts): no em dashes, no "delve"/"leverage"/"streamline", no filler. Write like a colleague who knows the account.
- **Adapt the layout to the content — never let it hide anything.** The brand system is fixed; the layout is not. If real content doesn't fit — a long company or person name, a 12-word title, 200 rows — change the layout, not the content: let the card grow, wrap instead of truncating, drop to one column, widen the column, raise the cap, or give the wide thing its own scroll container. Never solve a fit problem by clipping a card, ellipsing a name, or silently dropping rows. Where a cap really is unavoidable, say so in the UI ("showing the top 50 of 214") so the reader knows what they're not seeing. Look at the rendered output and fix what's cut off before you hand it over.
- **Icons in rendered output**: Lucide, the dashboard's icon set, inlined as SVG with a `currentColor` stroke. No emojis in artifact UI — the 🔥/🟡/⚪ scoring tiers are for chat; in a rendered artifact they become coloured pills or Lucide glyphs.
- **Logos and photos are free — use them in rendered output.** Person photos too: `basic_profile.profile_picture_permalink` rides in the `basic_profile` group `person_search` already returns, so a rendered people list shows faces rather than monograms. `basic_info.logo_permalink` comes back from `company_identify`, which you already call to resolve every row, and from `company_search`'s `basic_info` group. Base64-inline it as a `data:image/jpeg;base64,...` URI: the media CDN serves these as `binary/octet-stream`, so a remote `<img src>` renders blank. Fall back to a monogram when a company has none.
- **Artifact branding**: deliverables are chat-native by default (tables, CSV) — never render an artifact just to render one. But IF the user wants a deliverable as a rendered page or document (an HTML list, a TAM report, a doc), it carries the Crustdata brand lockup in the header or footer: a small uppercase "Powered by" eyebrow plus the official Crustdata wordmark, linking to crustdata.com. The wordmark pair ships in this skill's `assets/` — `crustdata-logo-light.png` (dark text, for light backgrounds) and `crustdata-logo-dark.png` (white text, for dark backgrounds), the same files app.crustdata.com's header renders. Base64-inline the theme-appropriate variant at ~17px height (both, theme-switched, on pages with a dark mode) — never hotlink; rendered artifacts cannot fetch remote images. Brand accent: `#5547E2` (the product primary; `#8387FF` on dark grounds). Body font: Geist when embeddable, else the system stack.
- Every execute response carries `credits` + `credits_remaining`; `account_credits` (free) reports the balance on demand.

## COST CHEAT SHEET

| Call | Cost |
|---|---|
| `company_identify`, autocomplete, `get_schema` | Free |
| `company_search` / `person_search` / `job_search` | ~0.03 cr/result |
| Count query (`limit: 1`, read `total_count`) | ~0.03-0.04 cr |
| `job_search` aggregations with `limit: 0` | counts only, ~free |
| `web_search_live` | 1 cr/query |
| `web_enrich_live` | 1 cr/page |
| `social_post_search_live` | 1 cr/post — 3 cr/post with `exact_keyword_match`; set `limit` deliberately |
| `person_contact_enrich` | no base; cap 5 cr/person |
| `company_enrich` | 2 cr/returned match; +2 if technographics requested and returned (2-4/match) |
| Person Discovery Watcher | first run free baseline, then 0.5 cr/new person |

## Tool dependencies

This skill requires:

- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)): a single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All Crustdata data tools are reached inside an `execute({ code })` plain-JavaScript script via `await callTool(name, params)`. Tools used here: `company_search`, `person_search`, `company_identify`, `company_autocomplete`, `person_autocomplete`, `job_search`, `web_search_live`, `web_enrich_live`, `social_post_search_live`, `person_contact_enrich` (opt-in), `company_enrich` (opt-in), `account_credits`
- **Crustdata REST API** (`api.crustdata.com`) for the champion-tracker watcher only — the skill prints a ready-to-run curl; the user supplies their API key and runs it after an explicit yes
