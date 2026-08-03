---
name: account-research
description: >
  Know a company completely. Opens by asking your goal and where your context lives
  (CRM? call recorder? team chat? email?), then routes to 4 modes - account deep-dive & plan
  (external + your internal history with them), org chart (who runs it), tech stack &
  wedge, competitive battlecard. Use for "tell me about <company>", "account plan for
  <company>", "org chart for <company>", "what's their tech stack", "battlecard for
  <competitor>", "how do we beat <X>", "research this account".
---

# Account Research

One job: **know a company completely** — what's publicly true (Crustdata + web) AND what your team already knows about them (CRM, calls, team chat, email). Most research skips the second half; that's where deals are actually won.

---

## Code Mode ground rules (read once, apply everywhere)

All Crustdata calls run inside the `execute` tool of the Crustdata MCP server ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)) as a plain-JavaScript script. Every snippet in this skill follows these rules:

- **Plain JavaScript only.** Author against the typed tool surface from `get_schema`, but the script body carries zero type annotations — a `: Type`, `as`, or generic is a parse error that fails the whole run before any tool call.
- **Open every script with a source-labeled comment**: `// user query: ...` or `// model query: ...`. Scripts without one are rejected before running (zero spend).
- **One I/O primitive:** `const r = await callTool(name, params)` → `{ ok: true, data }` or `{ ok: false, status, errorType, message }`. **Always branch on `r.ok`** — a failed call does not abort the script; an unchecked failure silently proceeds on empty data and looks like "no results".
- **Return the smallest projection.** Only what the script `return`s reaches the model. Shape results in-script (`project`, `pick`, plain `.map`), never return whole profiles.
- **Fan out independent calls** with `await parallelMap(items, fn)`; batch first with `chunk`. Never parallelize cursor pagination or dependent stages (search → enrich stays sequential; parallelize within a stage).
- **`fields` is a response whitelist.** The result carries only the groups you list; an omitted group reads as `undefined` later and looks like missing data. List every group you read.
- **Plan-gated projections fail the whole call with a 403** that names the field (e.g. `professional_network.followers` on `person_search`). Drop the named field and re-run. Filter on `professional_network.connections` when you need an activity floor; never project followers.
- **Categorical values are closed sets.** A plausible-but-wrong value silently returns zero rows. Resolve with `company_autocomplete` / `person_autocomplete` (free) before filtering on industries, funding round types, or seniority levels.
- **Zero results ≠ no matches.** A well-formed query can encode an ill-posed ask. Decompose, test each predicate's selectivity, and read the `trajectory` (per-call filters + counts) in the execute response before trusting a low or zero count.
- **`checkpoint(acc)` after costly stages** in long runs; a timed-out run returns it as `partial` so you can resume via `inputs`.

**Cost cheat sheet:** identify / autocomplete / schema = free. Search ~0.03 cr/result; count query (`limit: 1`, read `total_count`) ~0.03 cr. `company_enrich` 2 cr per returned match. Social posts 1 cr/post. Web search 1 cr/query. Web fetch 1 cr/page. `account_credits` (free) reports balance; every execute response carries credits used + remaining. Confirm with the user before a large spend.

---

## STEP 0 — Context intake (always, before researching)

1. **Config backbone (standalone-safe).** If `config/gtm-config.md` or `config/persona-profile.md` exist in the working directory, read them (what we sell → what's relevant). If they don't exist, ask 1-2 quick inline questions ("What do you sell, and who's your buyer?") or point at the **icp-builder** skill to set them up properly. A missing config never blocks the run.
2. **Ask where the context lives** (once per session, then remember): "Which of these do you have connected — a CRM? A call recorder? Team chat? Email?" Use ONLY what's actually connected; degrade gracefully — external-only research still works, just say what's missing.
3. Ask the goal (menu below) + which company.

## THE GOAL MENU

1. **Account deep-dive & plan** — everything about one target + how to attack it
2. **Org chart** — who runs it, who reports to whom (see `orgchart-playbook.md` in this folder — the full battle-tested pipeline)
3. **Tech stack & wedge** — what they run today + our opening
4. **Competitive battlecard** — how we beat a competitor

---

## Mode 1 — Account deep-dive & plan

### A. External sweep (Crustdata + web)

**Identify → enrich (the cheapest exact path).** `company_identify` is free but fuzzy — one domain or name can match several companies. Pick the top `confidence_score` match, then enrich by id with `exact_match: true` so you pay for exactly one match (2 credits):

```js
// model query: identify and enrich acme.com for an account deep-dive
const idr = await callTool("company_identify", { domains: ["acme.com"] });
if (!idr.ok) return { error: idr.message };
const matches = idr.data[0]?.matches ?? [];
const best = matches.reduce((a, b) => ((b.confidence_score ?? 0) > (a?.confidence_score ?? -1) ? b : a), null);
if (!best) return { error: "no company match for acme.com" };
const companyId = best.company_data?.basic_info?.crustdata_company_id ?? best.company_data?.crustdata_company_id;

const er = await callTool("company_enrich", {
  crustdata_company_ids: [companyId],
  exact_match: true,
  fields: ["basic_info", "headcount", "funding", "news"], // whitelist: list EVERY group you read
});
if (!er.ok) return { error: er.message };
const cd = er.data[0]?.matches?.[0]?.company_data ?? {};
const news = firstArray(cd.news) ?? [];
return {
  name: cd.basic_info?.name,
  description: cd.basic_info?.description,
  headcount: cd.headcount?.total,
  growth_12m_percent: cd.headcount?.growth_percent?.["12m"],
  last_round: cd.funding?.last_round_type,
  last_round_date: cd.funding?.last_fundraise_date,
  total_raised_usd: cd.funding?.total_investment_usd,
  news: news.slice(0, 10).map(n => ({
    title: n.article_title, url: n.article_url, date: n.article_publish_date,
  })),
};
```

Read: size, funding, 12-month growth, and the `news` group (articles carry `article_title` / `article_url` / `article_publish_date` — these become sourced citations in the plan).

**Open roles = pains + investment areas.** Aggregations with `limit: 0` give the hiring shape for pennies; a second call reads the newest postings:

```js
// model query: hiring shape + newest roles at acme.com
const base = [{ field: "company.basic_info.primary_domain", type: "=", value: "acme.com" }];
const [agg, fresh] = await parallelMap([
  {
    filters: { op: "and", conditions: base },
    aggregations: [{ type: "group_by", field: "job_details.category", agg: "count", size: 10 }],
    limit: 0,
  },
  {
    filters: { op: "and", conditions: base },
    sorts: [{ field: "metadata.date_added", order: "desc" }],
    limit: 15,
  },
], async (params) => await callTool("job_search", params));
if (!agg.ok) return { error: agg.message };
return {
  total_open_roles: agg.data.total_count,
  by_category: agg.data.aggregations,
  newest: fresh.ok
    ? fresh.data.job_listings.map(j => ({ title: j.job_details?.title, added: j.metadata?.date_added }))
    : [],
};
```

A company hiring 20 data engineers has a data problem; a company hiring its first security lead is about to buy security tooling. Say what the hiring shape implies.

**Treat `job_details.category` as a rough shape, not evidence.** Verified live on a 10,524-posting account: 30 distinct categories, the largest of which is the catch-all `Others` (29%), with overlapping labels (`Engineering`, `Engineering and Information Technology`, `Information Technology`) and both `Others` and `Other`. It is fine for a one-line "where are they hiring" read. For any claim you put in the plan — "9 of 19 engineering roles mention data pipelines" — count titles instead: `group_by` on `job_details.title`, or a small fan-out of `limit: 0` count queries with `[.]` on `job_details.title` / `content.description` per role family.

**Last-90-days news** — `web_search_live` (1 cr/query, keep it to 1-3 queries): funding, launches, exec moves, layoffs. Discard anything older than 90 days or label it as background.

**What THEY are talking about** — `social_post_list_live` is 1 credit per post, so set `limit` deliberately:

```js
// model query: what acme.com is posting about right now
const r = await callTool("social_post_list_live", { company_domain: "acme.com", limit: 10 });
if (!r.ok) return { error: r.message };
return r.data.posts.map(p => ({
  date: p.date_posted,
  type: p.post_type,
  text: (p.text ?? "").slice(0, 280),
  reactions: p.engagement?.total_reactions,
}));
```

**Leadership snapshot** — the senior layer in the function you sell to. Seniority levels are a closed set: resolve the exact labels with `person_autocomplete` on `experience.employment_details.current.seniority_level` first (expect values like `CXO`, `Vice President`, `Director`, `Owner / Partner`), then:

```js
// model query: leadership snapshot at company 12345 in the function we sell to
const seniorities = ["CXO", "Vice President", "Director"]; // verified via person_autocomplete
const r = await callTool("person_search", {
  filters: { op: "and", conditions: [
    eq("experience.employment_details.current.company_id", 12345),
    in_("experience.employment_details.current.seniority_level", seniorities),
  ]},
  fields: ["basic_profile", "experience", "social_handles"],
  limit: 25,
});
if (!r.ok) return { error: r.message };
return r.data.profiles.map(p => ({
  name: p.basic_profile?.name,
  title: p.basic_profile?.current_title,
  linkedin: profileUrl(p),
}));
```

### B. Internal sweep (the differentiator — use whatever is connected)

- **CRM**: past/open deals with them, contacts we know, notes, why past deals died
- **Call recorder**: search past calls with the account — their words, objections, promises
- **Team chat**: search the account name — internal chatter, warm intros, who knows them
- **Email**: past threads with their domain — existing relationships

Summarize as "our history with them": who we know, what was said, where it stalled. **Read-only, always** — research never writes to a connected system. If nothing is connected, skip B and say the plan is external-only.

### C. Synthesize the ACCOUNT PLAN (this is the deliverable)

- One-line read: what they do, where they're going, why now
- **Why we win here**: their pains (evidenced — cite the job post, article, or post) mapped to what we sell
- **Who to talk to**: champion / economic-buyer hypotheses (or run the org chart mode)
- **Our history**: relationships + past context (from B)
- **Entry play**: first move, warm path if any, the opener angle
- **Risks**: incumbent, timing, past failed deal
- 90-day next steps, dated

Write it clean (see the no-slop rule under Rules). Offer: deliver in chat, as a doc, continue into the org chart, find lookalikes with **sales-prospecting**, or export a CSV for your sequencer and hand off to your outreach tooling.

---

## Mode 2 — Org chart

Follow `orgchart-playbook.md` in this skill folder EXACTLY — it is battle-tested (size-branch, The Org for real reporting lines, hand-read titles, curation, base64 photos, standalone HTML, screenshot-or-preview self-review). Do not improvise a different chart.

---

## Mode 3 — Tech stack & wedge

1. **Job posts are ground truth.** Tools named in job descriptions are what the company actually runs. Probe with `job_search` on `content.description` — and this is CRITICAL: for a brand / product / tech name, always use the `[.]` exact-token operator (`exactToken(...)` builds it). The `(.)` operator is typo-tolerant and matches lookalike words, so `(.)` on "dbt" or "Ramp" pulls garbage. Keep `(.)` only for descriptive multi-word matching ("data quality", "revenue operations").

```js
// model query: which of these tools show up in acme.com job posts
const tools = ["Snowflake", "dbt", "Looker", "Datadog", "Terraform"];
const hits = await parallelMap(tools, async (t) => {
  const r = await callTool("job_search", {
    filters: { op: "and", conditions: [
      { field: "company.basic_info.primary_domain", type: "=", value: "acme.com" },
      exactToken("content.description", t), // [.] literal token, never (.) for brand names
    ]},
    limit: 1,
  });
  return { tool: t, job_posts: r.ok ? r.data.total_count : null, error: r.ok ? undefined : r.message };
});
return hits;
```

2. **Round out the picture**: `company_enrich` with `fields: ["basic_info", "competitors", "software_reviews", "taxonomy"]` for category and competitor context; `web_enrich_live` on their engineering blog / docs / integrations pages for stack mentions.
3. **Classify each item vs what you sell**: **incumbent competitor** (displacement play — name the switching cost), **complement** (integrate / land alongside), **gap** (greenfield).
4. **Output**: a stack map with a confidence tag per item — `job-post-confirmed` (named in a live job post, cite it) vs `inferred` (category/competitor/blog signal) — plus **THE WEDGE**: the one specific opening, phrased as an opener the rep could actually say out loud.

---

## Mode 4 — Competitive battlecard

1. **Profile the competitor**:
   - `company_identify` → `company_enrich` (`fields: ["basic_info", "headcount", "funding", "news"]`) — size, growth, funding posture, news
   - `job_search` category aggregation — where they're investing (hiring = roadmap)
   - `web_search_live` — last 90 days: launches, pricing changes, exec moves, layoffs
   - `social_post_list_live` (explicit `limit`, ~10) — their current messaging, in their own words
2. **The battlecard**:
   - Their ICP & strengths — **be honest; pretending they're weak gets reps killed**
   - Their gaps vs our differentiation
   - Landmine discovery questions — questions the prospect can ask the competitor that expose the gaps
   - Top-3 objections you'll hear + responses
   - Traps to avoid (claims of theirs you cannot beat head-on)
3. **Last-90-days rule**: every messaging or momentum claim must come from a post, article, or job post dated inside the last 90 days, or be flagged as possibly stale.
4. If it's for a live deal: mark which differentiators matter for THIS prospect's stated pains (from the internal sweep or the user).

---

## Rules

- Internal context is half the job — always ask what's connected and sweep it. Never skip because it's "just research".
- Facts get sources (Crustdata result / URL / call / CRM note). Inference gets labeled as inference.
- Read-only on CRM / recorder / team chat / email — research never writes.
- **No-slop rule on every deliverable**: no em dashes, no "delve" / "leverage" / "streamline", no filler sections — if there's nothing real to say, cut the section. Write like a colleague who did the homework.
- **Adapt the layout to the content — never let it hide anything.** The brand system is fixed; the layout is not. If real content doesn't fit — a long company or person name, a 12-word title, 200 rows — change the layout, not the content: let the card grow, wrap instead of truncating, drop to one column, widen the column, raise the cap, or give the wide thing its own scroll container. Never solve a fit problem by clipping a card, ellipsing a name, or silently dropping rows. Where a cap really is unavoidable, say so in the UI ("showing the top 50 of 214") so the reader knows what they're not seeing. Look at the rendered output and fix what's cut off before you hand it over.
- **Logos and photos are free — use them in rendered output.** `basic_info.logo_permalink` (company) comes from the free `company_identify` and from `company_enrich`'s `basic_info`; `basic_profile.profile_picture_permalink` (person) is already inside the `basic_profile` group `person_search` returns. Neither costs an extra credit. Base64-inline both as `data:image/jpeg;base64,...` URIs — the media CDN serves them as `binary/octet-stream`, so a remote `<img src>` renders blank. Monogram fallback when an image is missing.
- **Icons in rendered output**: Lucide, the dashboard's icon set, inlined as SVG with a `currentColor` stroke. No emojis in artifact UI.
- **Artifact branding**: deliverables default to chat or plain files — never render an artifact for its own sake. But IF a deliverable is rendered as a page or document (the org chart HTML, an account-plan doc, a battlecard page), it carries the Crustdata brand lockup in the header or footer: a small uppercase "Powered by" eyebrow plus the official Crustdata wordmark, linking to crustdata.com. The wordmark pair ships in this skill's `assets/` — `crustdata-logo-light.png` (dark text, for light backgrounds) and `crustdata-logo-dark.png` (white text, for dark backgrounds), the same files app.crustdata.com's header renders. Base64-inline the theme-appropriate variant at ~17px height — never hotlink; rendered artifacts cannot fetch remote images. Brand accent: `#5547E2` (the product primary; `#8387FF` on dark grounds). Body font: Geist when embeddable, else the system stack. The org chart's exact placement is specced in `orgchart-playbook.md`.
- Autocomplete-first on closed sets (industries, funding rounds, seniority). Never guess a categorical value.
- Costs are real: state the expected credit spend before post pulls, big people pulls, or enrich fan-outs.
- Hand off: lookalikes of this account → **sales-prospecting**; no ICP defined yet → **icp-builder**; first touch → export a CSV for your sequencer and hand off to your outreach tooling.

---

## Tool dependencies

This skill requires:

- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)): a single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All Crustdata data tools are reached inside an `execute({ code })` plain-JavaScript script via `await callTool(name, params)`. Tools used here: `company_identify`, `company_enrich`, `company_autocomplete`, `person_search`, `person_autocomplete`, `job_search`, `social_post_list_live`, `web_search_live`, `web_enrich_live`, `account_credits`
- **Optional connectors** the user may have: whatever CRM, call recorder, team chat, or email you use — all used read-only for the internal sweep; the skill degrades gracefully to external-only without them
- **Python** and **headless Chrome** (both optional, Claude Code only) for the org-chart HTML generator and self-review screenshot; environments without them use the fallbacks in `orgchart-playbook.md`
