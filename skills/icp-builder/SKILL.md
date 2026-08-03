---
name: icp-builder
description: >
  One-time GTM setup: paste one LinkedIn URL and Crustdata enriches it into a persona
  profile — who you are, what your company sells, your inferred ICP, your writing voice —
  saved as config/gtm-config.md and config/persona-profile.md, the files the
  sales-prospecting and account-research skills read at startup. Use when someone says
  "build my ICP", "set up my GTM config", "create my persona profile", "onboard me",
  "get me started", or when another GTM skill reports the config is missing.
---

# ICP Builder

One LinkedIn URL in, a working GTM config out. This skill enriches the user's own
profile via Crustdata and writes `config/persona-profile.md` + `config/gtm-config.md` —
the files **sales-prospecting** and **account-research** read at startup.

Three steps, always in this order:

1. **Stack** (optional, fully skippable): which tools they use.
2. **Persona**: one LinkedIn URL; Crustdata turns it into who they are, what they sell,
   an inferred ICP, and their writing voice.
3. **Write config + hand off.**

**Never interrogate the user.** Do not ask "what do you sell", "who's your ICP", or
"paste your voice emails". All of that is derived from the LinkedIn URL and their posts.
The URL is the entire interview.

---

## Step 0: check for an existing config

If `config/gtm-config.md` or `config/persona-profile.md` already exist in the working
directory, read them, summarize what's there in two lines, and ask whether to refresh
the whole persona or update specific fields. Never silently overwrite a config the user
already corrected. On a refresh, carry the existing Stack entries forward unchanged and
do not re-ask the stack question unless the user asks to change it. Missing files are
the normal case — this skill creates them.

## Step 1: welcome + optional stack question

Open with one short welcome line, then ONE optional question: **which tools do you
use?** One quick pass through the slots; the user names a tool or says skip. If they
skip the whole question, write `none` everywhere and move on.

- **Data provider** — Crustdata, the data source these skills run on (added as a
  connector; if it's not connected, use the no-data fallback below)
- **CRM** — or skip
- **Calendar** — or skip
- **Email** — or skip
- **Call recorder** — or skip
- **Sequencer** — or skip
- **Team chat** — or skip

Rules for this step:

- **Never assume the stack from connected connectors.** A connected connector is not
  the user's choice. Ask, or write `none`.
- Every slot is skippable; never pressure or re-ask a declined tool.
- Skipped slot = `none` in the config = downstream skills run that slot draft-only:
  drafts and CSV exports instead of pushing to the tool ("export a CSV for your
  sequencer", "log to a file instead of the CRM").

## Step 2: LinkedIn URL → persona

Ask for one thing: their **LinkedIn URL**. Then build the persona in one `execute`
script. The person lookup comes first; the company enrich and the posts pull both
depend on it but not on each other, so fan those two out with `parallelMap`.

Every script must open with a source-labeled query comment (`// user query: ...` or
`// model query: ...`) — scripts without one are rejected before running, at zero spend.

```js
// user query: set up my GTM config — my LinkedIn is https://www.linkedin.com/in/example
const url = "https://www.linkedin.com/in/example";

// Stage 1: the person. Base cost 1 credit. `fields` is a response WHITELIST —
// the result carries ONLY the groups listed here; an omitted group reads as
// undefined later and looks like missing data. basic_profile + experience covers
// the persona; social_handles carries the canonical profile URL the posts pull
// is keyed on; contact groups only add cost.
const pr = await callTool("person_enrich", {
  professional_network_profile_urls: [url],
  fields: ["basic_profile", "experience", "social_handles"],
});
if (!pr.ok) return { error: pr.message };
const person = pr.data[0]?.matches?.[0]?.person_data;
if (!person) return { error: "no_match" }; // → confirm the URL, then no-data fallback

const canonicalUrl = profileUrl(person) ?? url; // preloaded accessor
const current = person.experience?.employment_details?.current?.[0] ?? {};
const companyId = currentCompanyIds(person)[0]; // preloaded accessor

// Stage 2: company + posts are independent of each other — fan them out.
const calls = [
  { name: "social_post_list_live",
    params: { professional_network_profile_url: canonicalUrl, limit: 10 } }, // 1 cr/post — cap deliberately
];
if (companyId) {
  calls.push({ name: "company_enrich",
    params: { crustdata_company_ids: [companyId], exact_match: true,
              fields: ["basic_info", "taxonomy"] } }); // 2 cr, exactly one match
}
const results = await parallelMap(calls, async (c) => ({ name: c.name, r: await callTool(c.name, c.params) }));

const postsR = results.find(x => x.name === "social_post_list_live")?.r;
const companyR = results.find(x => x.name === "company_enrich")?.r;

// Posts are optional: a failed or empty pull means neutral voice, not a failed run.
const posts = postsR && postsR.ok
  ? (postsR.data.posts ?? []).map(p => ({
      text: p.text,
      date: p.date_posted,
      reactions: p.engagement?.total_reactions,
      comments: p.engagement?.total_comments,
    }))
  : [];

const company = companyR && companyR.ok
  ? pick(companyR.data[0]?.matches?.[0]?.company_data ?? {}, ["basic_info", "taxonomy"])
  : null;

// Return the smallest projection — only what the script returns reaches the model.
return {
  identity: {
    name: person.basic_profile?.name,
    title: person.basic_profile?.current_title,
    location: person.basic_profile?.location,
    company: current.name,
    company_domain: current.company_website_domain,
    start_date: current.start_date, // tenure = today minus this
  },
  past_roles: (person.experience?.employment_details?.past ?? []).slice(0, 5)
    .map(e => ({ company: e.name, title: e.title })),
  company,
  posts,
};
```

Notes on this script:

- **Never set `preview: true` on `person_enrich`.** It is plan-dependent and returns a
  400 on some accounts. The flow must never depend on it; base cost is 1 credit anyway.
- **Keep `person_enrich` fields to `basic_profile` + `experience` + `social_handles`.**
  Without `social_handles` in the whitelist the `profileUrl` accessor reads
  `undefined` and the posts pull falls back to the raw user-typed URL. Some groups
  (`certifications`, `honors`, `updated_at`) are plan-gated — a gated projection fails
  the WHOLE call with a 403 that names the field. If that happens, drop the field and
  re-run.
- Response paths differ from filter paths: the title lives at
  `basic_profile.current_title`, the current employer at
  `experience.employment_details.current[].name`, the canonical profile URL at
  `social_handles.professional_network_identifier.profile_url` (the `profileUrl`
  accessor reads it for you).

### Company fallback: no company id on the profile

If the current employment carries no company id, resolve the company by domain (or
name) first. `company_identify` is free and fuzzy — one identifier can return several
companies — so pick the top `confidence_score` match, then enrich by id with
`exact_match: true`. That is the cheapest exact path: free identify + 2 credits for
exactly one enriched match.

```js
// model query: resolve and enrich the user's current company by domain
const idr = await callTool("company_identify", { domains: ["example.com"] }); // ONE identifier type per call
if (!idr.ok) return { error: idr.message };
const matches = idr.data[0]?.matches ?? [];
const top = matches.slice().sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))[0];
if (!top) return { error: "no_company_match" };
const id = top.company_data?.basic_info?.crustdata_company_id ?? top.company_data?.crustdata_company_id;

const er = await callTool("company_enrich", {
  crustdata_company_ids: [id],
  exact_match: true,
  fields: ["basic_info", "taxonomy"],
});
if (!er.ok) return { error: er.message };
return pick(er.data[0]?.matches?.[0]?.company_data ?? {}, ["basic_info", "taxonomy"]);
```

Do not project `social_profiles` on `company_identify` — it is plan-gated and 403s the
whole call.

### Derive the persona from the returned data

- **Identity**: name, title, company, tenure (from `start_date`), one-line background
  from the past roles.
- **Company & what we sell**: product and category from `basic_info` + `taxonomy`;
  keywords to monitor from the company description and the user's post topics.
- **Voice**: tone and style notes from the actual posts — sentence length, first vs.
  third person, jargon level, emoji use, how they open. If posts are empty, write
  "neutral" and move on.
- **Topics they care about**: recurring themes across the posts, weighted by
  engagement.

### Inferred ICP — label it, and make it filter-ready

Derive the ICP from what the company sells plus who typically buys it: industries,
headcount range, geography, funding stage, buyer titles, buyer seniority. **Always
label it `inferred`** — it is a hypothesis for the user to correct, not a fact.

Write ICP values that downstream searches can use directly. Categorical fields are
closed sets — a plausible-but-wrong value silently returns zero rows — so resolve them
via autocomplete (free) before writing the config:

```js
// model query: resolve filter-ready values for the inferred ICP
const probes = [
  { tool: "company_autocomplete", params: { field: "basic_info.industries", query: "software" } },
  { tool: "person_autocomplete",  params: { field: "experience.employment_details.current.seniority_level", query: "vice" } },
];
return await parallelMap(probes, async (p) => {
  const r = await callTool(p.tool, p.params);
  // Returns shape is { suggestions: [{ value }] } — project to the value strings.
  return { field: p.params.field, values: r.ok ? (r.data.suggestions ?? []).map(s => s.value) : [], error: r.ok ? null : r.message };
});
```

Buyer seniority must use the exact vocabulary of
`experience.employment_details.current.seniority_level`: `Entry Level`,
`Entry Level Manager`, `Experienced Manager`, `Senior`, `Director`, `Vice President`,
`CXO`, `Owner / Partner`, `In Training`, `Strategic`. When unsure, resolve through
`person_autocomplete` rather than guessing.

### Accuracy is non-negotiable

This profile drives every downstream skill; wrong info poisons everything.

- Only write what the source data supports. If something can't be confirmed, say so
  instead of guessing.
- Label every inference (the ICP is always labeled `inferred`).
- **Show the persona back before writing files**: "Here's who I think you are —
  correct me if I'm off." Apply corrections, then write.

## Step 3: write the config files

Write both files in the working directory. `config/persona-profile.md` is the full
persona; `config/gtm-config.md` repeats the Company / ICP / Voice essentials plus the
stack so every skill finds them in one read.

### `config/persona-profile.md`

```markdown
# Persona Profile
Built by icp-builder on <YYYY-MM-DD>. Read by sales-prospecting and account-research.

## Identity
- Name:
- Title:
- Company: <name> (<domain>)
- Tenure: since <start date>
- Background: <one line from past roles>

## Company & what we sell
- Product:
- Category:
- Keywords to monitor:

## Inferred ICP
Label: inferred from <what the company sells + typical buyers>. User-confirmed: <yes/no>
- Industries: <filter-ready values>
- Headcount:
- Geography:
- Funding stage:
- Buyer titles:
- Buyer seniority: <exact seniority vocabulary values>

## Voice
- Tone:
- Style notes:
- Always: no em dashes; never "delve", "leverage", or "streamline"; no filler;
  write like a colleague.

## Topics they care about
- <from posts, weighted by engagement>
```

### `config/gtm-config.md`

```markdown
# GTM Config
Read by sales-prospecting and account-research at startup.

## Stack
- Data provider: crustdata | none
- CRM: <tool> | none
- Calendar: <tool> | none
- Email: <tool> | none
- Call recorder: <tool> | none
- Sequencer: <tool> | none
- Team chat: <tool> | none

`none` = that slot runs draft-only: drafts and CSV exports instead of pushing to the tool.

## What we sell
<one or two lines>

## ICP (inferred)
- Industries:
- Headcount:
- Geography:
- Funding stage:
- Buyer titles:
- Buyer seniority:

## Customers
none yet — add names or domains as you close; sales-prospecting uses them for lookalikes.

## Voice
<tone in one line>. No em dashes; never "delve", "leverage", or "streamline"; no filler;
write like a colleague.
```

### Hand off

Summarize: stack connected vs skipped, the persona in 2-3 lines, and what was labeled
inferred. Then:

> You're set up. Try **sales-prospecting** ("build me a list from my ICP") or
> **account-research** ("research <company>") — both read this config automatically.

---

## No-data fallback

If Crustdata isn't connected, or enrichment comes back thin (no match, sparse profile,
zero posts):

- Take 2-3 lines from the user instead: name and role, what the company does, who
  they sell to. That's the whole interview — **never run a long questionnaire.**
- Write both config files from those lines. Voice = neutral plus the no-slop rule.
  ICP = still labeled `inferred`.
- If enrichment was partial, keep what was verified, say exactly what couldn't be
  inferred, and let the user add a line for just that.

## Costs

- `person_enrich` with `basic_profile` + `experience` + `social_handles`: 1 credit.
- `company_identify`, `company_autocomplete`, `person_autocomplete`: free.
- `company_enrich` by id with `exact_match: true`: 2 credits for one match.
- `social_post_list_live`: 1 credit per post — always set `limit` deliberately
  (10 is plenty for voice).
- Typical full run: about 13 credits. Every `execute` response carries `credits` and
  `credits_remaining`; `account_credits` (free) reports the balance.

## Error handling

- **Branch on `r.ok` in every script.** A failed call does not abort the script; an
  unchecked failure silently proceeds on empty data and looks like "no results".
- `person_enrich` returns no match → confirm the URL with the user (typo, vanity slug
  change), then use the no-data fallback.
- A 403 that names a field means a plan-gated projection — drop that field and re-run.
- A failed or empty posts call is not an error: voice goes neutral.
- Company enrich fails → keep the persona from person data alone and note what's
  missing.

## Rules

- **Welcome first; one optional stack question; the URL is the entire interview.**
- **Never assume the stack from connected connectors.** Ask, or write `none`.
- **Never ask what they sell, their ICP, or their voice** — derive it. If enrichment is
  thin, take 2-3 lines, never a full interview.
- **Show the persona back** for correction before writing files.
- **Label inferences.** Write `none` for skipped tools. Never invent stack or persona
  details.
- **Voice always carries the no-slop rule**: no em dashes; never "delve", "leverage",
  or "streamline"; no filler; write like a colleague.
- A missing config never blocks anything: this skill creates it, and downstream skills
  point back here when it's absent.
- **Adapt the layout to the content — never let it hide anything.** The brand system is fixed; the layout is not. If real content doesn't fit — a long company or person name, a 12-word title, 200 rows — change the layout, not the content: let the card grow, wrap instead of truncating, drop to one column, widen the column, raise the cap, or give the wide thing its own scroll container. Never solve a fit problem by clipping a card, ellipsing a name, or silently dropping rows. Where a cap really is unavoidable, say so in the UI ("showing the top 50 of 214") so the reader knows what they're not seeing. Look at the rendered output and fix what's cut off before you hand it over.
- **Icons in rendered output**: Lucide, the dashboard's icon set, inlined as SVG with a
  `currentColor` stroke. No emojis in artifact UI.
- **The persona's own photo is free too** — `basic_profile.profile_picture_permalink` rides in
  the `basic_profile` group the Step 2 `person_enrich` already returns. A persona one-pager is
  about a person; base64-inline the photo (same `binary/octet-stream` rule) with a monogram
  fallback.
- **The company logo is free — use it on a rendered persona page.** `basic_info.logo_permalink` comes from the free `company_identify` and from the `company_enrich` you already run for the persona. Base64-inline it as a `data:image/jpeg;base64,...` URI (the media CDN serves these as `binary/octet-stream`, so a remote `<img src>` renders blank); monogram fallback when there's none.
- **Artifact branding**: the config files stay plain markdown — no branding noise in
  machine-read files. But IF the persona is rendered as a page or document (a persona
  one-pager, an ICP summary doc), it carries the Crustdata brand lockup in the header or
  footer: a small uppercase "Powered by" eyebrow plus the official Crustdata wordmark,
  linking to crustdata.com. The wordmark pair ships in this skill's `assets/` —
  `crustdata-logo-light.png` (dark text, for light backgrounds) and
  `crustdata-logo-dark.png` (white text, for dark backgrounds), the same files
  app.crustdata.com's header renders. Base64-inline the theme-appropriate variant at
  ~17px height — never hotlink; rendered artifacts cannot fetch remote images. Brand
  accent: `#5547E2` (the product primary; `#8387FF` on dark grounds). Body font: Geist
  when embeddable, else the system stack. Never render an artifact just to carry the mark.

## Tool dependencies

This skill requires:

- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)):
  a single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All
  Crustdata data tools are reached inside an `execute({ code })` plain-JavaScript
  script via `await callTool(name, params)` — author against the typed surface from
  `get_schema`, but the script body carries zero type annotations (a type annotation is
  a parse error that fails the whole run). Tools used here: `person_enrich`,
  `company_identify`, `company_enrich`, `social_post_list_live`,
  `company_autocomplete`, `person_autocomplete`, `account_credits`.
- **Write access to the working directory** — creates `config/persona-profile.md` and
  `config/gtm-config.md`.

Ships alongside **sales-prospecting** and **account-research**, which read the config
this skill writes.
