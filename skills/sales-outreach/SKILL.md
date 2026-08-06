---
name: sales-outreach
description: >
  Write the touch, grounded in a real signal. Every cold email, call script, LinkedIn
  note, reply, and sequence is built on ONE specific, recent, dated signal pulled from
  Crustdata — their post, their raise, their new exec, their job listing — never a
  generic template and never an invented reference. 7 modes: cold email, call script,
  LinkedIn touches, reply handler, objection talk-tracks, multi-touch sequence builder,
  signal-triggered drafts. Use for "write a cold email to <person>", "what do I say",
  "they replied saying <X>", "handle the <objection> objection", "build a sequence",
  "draft outreach for these accounts", "write my follow-up", "give me a call script for
  <company>".
---

# Sales Outreach

One job: **what do I say — and can they tell I actually looked?**

The copy is the easy half. The reason a touch lands is that it opens with something
specific, recent, and true about the person reading it: a post they wrote last week, the
round they closed last month, the role they just opened, the exec they just hired. This
skill pulls that from Crustdata **first**, then writes around it.

**The hook comes before the copy. Always.** A beautifully written email built on
"I saw you're in fintech" is a template. A blunt three-line email built on "your Tuesday
post about the on-call rotation" gets replies. If no real signal exists for a target, say
so and offer a different angle — **never invent a hook.**

---

## Code Mode ground rules (read once, apply everywhere)

All Crustdata calls run inside the `execute` tool of the Crustdata MCP server
([install.crustdata.com/mcp](https://install.crustdata.com/mcp)) as a plain-JavaScript
script. Every snippet below follows these rules:

- **Plain JavaScript only.** Author against the typed tool surface from `get_schema`, but
  the script body carries zero type annotations — a `: Type`, `as`, or generic is a parse
  error that fails the whole run before any tool call, at zero spend.
- **Open every script with a source-labeled comment**: `// user query: ...` for the
  user's literal ask, `// model query: ...` for a derived step. Scripts without one are
  rejected before running.
- **One I/O primitive:** `const r = await callTool(name, params)` → `{ ok: true, data }`
  or `{ ok: false, status, errorType, message }`. **Always branch on `r.ok`** — a failed
  call does not abort the script, so an unchecked failure silently proceeds on empty data
  and looks like "they have no recent activity". That is exactly the failure that
  produces a fabricated hook.
- **`fields` is a response whitelist.** The result carries only the groups you list; an
  omitted group reads as `undefined` later and looks like missing data. List every group
  you read.
- **Return the smallest projection.** Only what the script returns reaches the model. For
  outreach that means hook candidates — date, one line of text, a link — never raw posts
  or whole profiles.
- **Fan out independent work** with `await parallelMap(items, fn)`; `chunk` first where
  there is a per-call cap. Never parallelize cursor pagination or dependent stages.
  `checkpoint(acc)` after a costly stage so a timeout still returns the hooks you paid
  for.

---

## Step 0 — Intake (always, before writing a word)

1. **Config backbone, never blocking.** If `config/persona-profile.md` or
   `config/gtm-config.md` exist in the working directory, read them: the rep's voice
   (tone, sentence length, sign-off, never-do list), what they sell, who buys. If they
   don't exist, ask one inline question ("What do you sell, and what's your sign-off?")
   or point at the **icp-builder** skill, which writes both files from one LinkedIn URL.
   A missing config never blocks a draft — write in a plain, direct voice and say you
   did.
2. **Confirm the ask in one line**: WHO (person, account, or list) — CHANNEL (email /
   call / LinkedIn) — MOMENT (first touch / follow-up / reply / objection) — GOAL
   (a meeting? an answer? an intro?).
3. **Pull the hook** (next section). One sharp hook beats five soft ones.

---

## THE HOOK LAYER (this is the skill)

Four sources, cheapest and most specific first. Pull **one**; stop when you have
something good. Running all four on one person is usually a waste of credits.

### Hook 1 — what they said (their posts)

The best hook there is, because it's theirs and it's dated. Keyed on the person's
professional network profile URL. **1 credit per post, so `limit` is the spend dial** —
5 is plenty to find one hook.

```js
// user query: write a cold email to https://www.linkedin.com/in/example — find a hook first
const url = "https://www.linkedin.com/in/example";
const cutoffMs = Date.now() - 60 * 24 * 3600 * 1000; // hooks older than ~60 days read as stale

const r = await callTool("social_post_list_live", {
  professional_network_profile_url: url, // person key; company_domain / crustdata_company_id key the company feed
  limit: 5,                              // 1 CREDIT PER POST — set this deliberately
  fields: ["text", "date_posted", "post_type", "engagement", "hyperlinks", "share_url"], // whitelist
});
if (!r.ok) return { hooks: [], error: r.message };

const parse = (d) => { const t = Date.parse(d ?? ""); return Number.isNaN(t) ? null : t; };
const posts = (r.data.posts ?? []).map(p => ({
  date: p.date_posted,
  ms: parse(p.date_posted),
  type: p.post_type,
  url: p.share_url, // the link to the post itself — the rep needs it to verify in five seconds
  text: (p.text ?? "").slice(0, 400),
  reactions: p.engagement?.total_reactions,
  comments: p.engagement?.total_comments,
  links: p.hyperlinks?.other_urls ?? [],
}));
return {
  fresh: posts.filter(p => p.ms !== null && p.ms >= cutoffMs),
  stale: posts.filter(p => p.ms !== null && p.ms < cutoffMs).length,
  undated: posts.filter(p => p.ms === null), // never silently drop these — read them yourself
};
```

Reading the result: prefer a post they **wrote** over a reshare with no commentary, and
an opinion over an announcement. A post with a real take gives you a sentence you can
agree or disagree with, which is what earns a reply.

### Hook 2 — what happened to the company (funding, news, growth)

`company_identify` is free but fuzzy — one domain can match several companies. Take the
top `confidence_score`, then enrich **by id** so you pay for exactly one match (2 credits).
Enriching by domain or name instead can fuzzy-match several companies and bill 2 credits
per returned match, which `exact_match: true` narrows but does not guarantee down to one.

```js
// model query: recent company events at acme.com worth opening an email with
const idr = await callTool("company_identify", { domains: ["acme.com"] }); // free, one identifier type per call
if (!idr.ok) return { error: idr.message };
const matches = idr.data[0]?.matches ?? [];
const best = matches.slice().sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))[0];
if (!best) return { error: "no company match for acme.com" };
const companyId = best.company_data?.basic_info?.crustdata_company_id ?? best.company_data?.crustdata_company_id;

const er = await callTool("company_enrich", {
  crustdata_company_ids: [companyId],                       // one id = one match = exactly 2 credits
  exact_match: true,                                        // narrows the fuzzy match; by-name/by-domain can still return >1 -> N x 2 cr
  fields: ["basic_info", "funding", "headcount", "news"],    // whitelist: list EVERY group you read
});
if (!er.ok) return { error: er.message };
const cd = er.data[0]?.matches?.[0]?.company_data ?? {};
const news = (firstArray(cd.news) ?? []).slice(0, 10).map(n => ({
  title: n.article_title, url: n.article_url, date: n.article_publish_date,
}));
return {
  name: cd.basic_info?.name,
  lastRound: cd.funding?.last_round_type,
  lastRaise: cd.funding?.last_fundraise_date,
  lastRoundUsd: cd.funding?.last_round_amount_usd,
  investors: cd.funding?.investors,
  headcount: cd.headcount?.total,
  growth12m: cd.headcount?.growth_percent?.["12m"],
  news,
};
```

Funding is a hook with a shelf life. A round closed 3 weeks ago is "congrats + here's what
usually breaks next"; a round closed 14 months ago is background, not an opener. News
articles carry a real publish date — use it in the sentence and link the article if you
reference a specific claim.

### Hook 3 — what they're hiring for

Job posts are the most honest thing a company publishes. The roles they're opening are
the problems they've agreed to spend money on.

```js
// model query: what acme.com is hiring for, and whether their posts name our category
const domain = "acme.com";
const term = "<the tool you displace>"; // a brand/product/tech name -> ALWAYS [.] exact token, never (.)
const [fresh, named] = await parallelMap([
  {
    filters: eq("company.basic_info.primary_domain", domain),
    sorts: [{ field: "metadata.date_added", order: "desc" }],
    fields: ["job_details", "location", "metadata"],
    limit: 15,
  },
  {
    filters: and_(
      eq("company.basic_info.primary_domain", domain),
      exactToken("content.description", term) // [.] guarantees the literal token; (.) is typo-tolerant and pulls lookalikes
    ),
    fields: ["job_details"],
    limit: 1, // count query — read total_count, don't download rows
  },
], async (params) => await callTool("job_search", params));
if (!fresh.ok) return { error: fresh.message };
return {
  newest: fresh.data.job_listings.map(j => ({
    title: j.job_details?.title,
    city: j.location?.city,
    added: j.metadata?.date_added,
  })),
  total_open: fresh.data.total_count,
  postings_naming_term: named.ok ? named.data.total_count : null,
};
```

**Scope roles by title, not `job_details.category`** — the category field is coarse and
most postings land in the catch-all. If you want to say "you've got four data engineering
roles open", count titles.

The hook writes itself from the shape: three SDR reqs open means a pipeline target they
just raised. A first security hire means they're about to buy security tooling. Name the
actual role and when it was posted.

### Hook 4 — a signal that already fired

The best case: the work is already done. **sales-prospecting**'s champion tracker,
expansion radar, and account ranking all emit dated signal rows. Hand one straight in and
skip the pull entirely.

A handed-over row looks like: *person — was [role] at [your customer] — now [title] at
[new company] — landed [date]*. That IS the hook, and it's already dated. Same for
"raised Series B on 2026-04-12" or "hired a VP Data 6 weeks ago".

Do not re-pull what you were handed. Spend a credit only to add colour (their first post
in the new job, say) and only if the draft needs it.

### Signal → angle

| Signal | The angle | The opening move |
|---|---|---|
| Fresh raise (<3 months) | Scaling pain — what breaks at the next headcount | Congratulate in half a sentence, then the pain the round creates |
| New exec in your function | New mandate, 90-day plan, fresh budget | "New in seat" energy: what are they inheriting |
| Champion moved to a new company | They already know you work | "Congrats — you know how this goes" (warmest touch there is) |
| Hiring surge in a relevant team | They've agreed the problem is real | Reference the roles; ask what happens between now and the hires landing |
| A post with a real opinion | Agree, extend, or politely disagree | Respond to the *idea*, not to the fact that they posted |
| Tech named in job posts | Stack fit or displacement | Name the tool, name the seam |
| Company news / launch | Timing | Tie the launch to the pain your product removes |

### No hook, no fabrication

If the pulls come back empty — no recent posts, funding two years old, no open roles —
**say that out loud** and offer the alternatives instead of inventing a reference:

- Write from a **role-level** insight ("every VP Eng at 300 people hits this") and label
  it as such — a good generic beats a fake specific.
- Pull a hook on a **different person** at the same account who is active — if you already
  have their profile URL (from the user's list, or from **sales-prospecting** /
  **account-research**, which do the person discovery), run Hook 1 on them instead.
- Use the account's own words: `social_post_list_live` keyed on `company_domain` gives
  the company feed when the individual is quiet.
- Recommend waiting for a signal and setting up the watcher in **sales-prospecting**'s
  champion tracker.

A hook must pass three tests before it goes in a draft: **is it theirs** (not their
industry's), **is it dated** (post ≤60 days, funding/news ≤90 days), and **would they
recognize it in one read**.

---

## THE TOUCH TYPES

### 1. Cold email

**Under 90 words.** Subject 3-5 words, lowercase-ish, no clickbait, no "quick question".

- **Line 1 — the hook.** Their thing, dated, in their language. The reader should think
  "yes, I did that".
- **Line 2 — the bridge.** One sentence connecting their thing to the pain you solve.
- **Line 3 — one concrete outcome.** A number or a named customer situation, not a value
  prop.
- **Line 4 — one ask.** The lowest-friction version that still moves ("worth 15 minutes
  Thursday?" or "want me to send the two-line version?").
- Their sign-off, if the persona config carries one. The config written by **icp-builder** records tone and style but not a sign-off, so ask for it inline the first time and reuse it after.

One hook, one idea, one ask. Offer **2-3 angle variants** for testing (different hook, or
same hook different pain) and say which one you'd send.

### 2. Call script

- **Opener + permission line** ("caught you cold — 30 seconds and you can tell me to go
  away?").
- **Reason for the call**, tied to the same hook. Cold calls die on "just reaching out".
- **Value hypothesis** in one sentence, framed as a guess they can correct.
- **2-3 open discovery questions** — how they handle it today, what it costs them.
- **The ask: a meeting, not a sale.**
- **Objection branches**, written out: not interested / send me an email / we already use
  something / no budget / gatekeeper. Each is one acknowledgment plus one question that
  keeps the call alive.
- **15-second voicemail** and a **one-line follow-up text**, both referencing the same
  hook so the touches stack.

### 3. LinkedIn touches

- **Connection note** — 300 characters max, **no pitch**. The hook plus a reason to
  connect.
- **First DM** — value or a smart question. Still no pitch.
- **Follow-up** — a soft ask, only after a reply or a signal.
- **Break-up** — one line, gracious, leaves the door open.

Before any of it, suggest **1-2 of their recent posts worth a genuine comment** — you
already have them from Hook 1, at no extra cost. A real comment three days before a
connection request does more than any first line.

### 4. Reply handler

Classify first, then advance. Match their length and their energy — a two-line reply gets
a two-line answer.

| Reply type | The move |
|---|---|
| Interested | Propose two concrete times. Nothing else. Do not re-pitch. |
| Question | Answer it directly in one paragraph, then the ask. |
| Objection | Go to talk-tracks (below). |
| Referral out ("talk to X") | Thank them, ask for the intro or permission to name them, then open the new thread with the referral as the hook. |
| Not now | Get the date. "Should I come back in Q1?" Then actually log it. |
| Hard no | One gracious line, exit. No last-ditch pitch. |
| Unsubscribe | Honor immediately. No counter-offer, no "just confirming". Remove from every sequence. |

### 5. Objection talk-tracks

**Diagnose the real objection first.** "Too expensive" is usually "value unclear" or "no
internal champion". "Bad timing" is usually "not a priority". Say what you think the real
one is before answering it.

Then: **acknowledge → reframe → one real proof point → soft re-ask.** One proof point,
and it must be real — a named situation, a number you can defend. Never invent a case
study.

Give two variants: **direct** (for a buyer who's blunt) and **soft** (for a relationship
you're still building).

**Playbook mode**: the team's top 8-10 objections in one document, each with the
diagnosis, both variants, and the trap to avoid. This one is worth rendering as a page —
see the artifact rule under Rules.

### 6. Sequence builder

1. **The cadence table first** — day, channel, angle, personalization level. Vary the
   angle across touches: problem → proof → a different persona's pain → social proof →
   break-up. Never send the same idea five times in different words.
2. **Then write every touch** using types 1-3.
3. **Mark each touch** `1:1` (rep writes a custom line) vs `merge-field` (scales across
   the list), and flag exactly where the rep must add something only they know.
4. **Hook freshness**: touch 1 carries the pulled hook. By touch 4 that hook is two weeks
   old — either re-pull or switch to an angle that doesn't depend on recency. Say which
   in the table.

Typical shape (adapt to the motion, don't ship this as-is):

| Day | Channel | Angle | Personalization |
|---|---|---|---|
| 1 | Email | The hook + the pain it implies | 1:1 |
| 3 | LinkedIn | Connection note, same hook, no pitch | 1:1 |
| 5 | Call + voicemail | Reason-for-call = the hook | 1:1 |
| 8 | Email | Proof point, in-thread | merge-field |
| 12 | Email | A different persona's version of the pain | merge-field |
| 18 | Email | Break-up, one line | merge-field |

### 7. Signal-triggered drafts

Input: a signal that just fired (new funding, exec hire, champion moved, hiring surge),
usually handed over from **sales-prospecting**. Output: a draft that references the actual
trigger **with its date**, mapped through the signal → angle table above.

The rule that makes these work: the draft must be sendable the week the signal fired. A
"congrats on the round" email six weeks late is worse than nothing. If the signal is
already stale, say so and re-angle.

To keep signals flowing automatically, point the user at **sales-prospecting**'s champion
tracker, which sets up the recurring watcher.

---

## THE NO-SLOP RULE (every draft, no exceptions)

Run this pass on every piece of copy **before showing it**. A touch that smells like AI is
worse than no touch — it tells the reader they were on a list.

Kill on sight:

- **Em dashes.** Use a period or a comma.
- "I hope this finds you well", "I wanted to reach out", "quick question", "circling
  back", "just following up".
- **"delve", "leverage", "streamline", "unlock", "elevate", "seamless", "robust".**
- **Rule-of-three constructions** ("faster, cheaper, and more reliable").
- **Negative parallelism** ("not just X, but Y").
- Filler adverbs: "really", "actually", "truly", "incredibly".
- Fake familiarity ("Hope you're crushing it!") and fake urgency.
- Any sentence that would survive a find-and-replace of the company name. If it works for
  any company, it works for none.

Then read it out loud. It should sound like the rep texting a smart colleague. **If a
draft reads like a template, rewrite it — do not ship slop.**

---

## LIST MODE — many accounts, one run

When the input is a list (usually a scored list from **sales-prospecting**), the order is
always: hooks → copy → export. Not the reverse.

**Step 1 — fan out the hooks.** Independent per person, so `parallelMap` them. State the
cost before running: posts are 1 credit each, so `limit: 3` across 40 people is up to 120
credits.

```js
// user query: draft outreach for these 40 accounts — pull a hook for each first
const people = inputs.people; // [{ name, profileUrl, company, domain }]
const cutoffMs = Date.now() - 60 * 24 * 3600 * 1000;

const hooks = await parallelMap(people, async (p) => {
  const r = await callTool("social_post_list_live", {
    professional_network_profile_url: p.profileUrl,
    limit: 3,                                        // 1 cr/post x 3 x N people — quote this before running
    fields: ["text", "date_posted", "post_type", "share_url"],
  });
  if (!r.ok) return { name: p.name, hook: null, reason: r.message };
  const fresh = (r.data.posts ?? [])
    .map(x => ({ date: x.date_posted, ms: Date.parse(x.date_posted ?? ""), url: x.share_url, text: (x.text ?? "").slice(0, 300) }))
    .filter(x => !Number.isNaN(x.ms) && x.ms >= cutoffMs);
  return { name: p.name, company: p.company, hook: fresh[0] ?? null, reason: fresh.length ? null : "no recent post" };
});
checkpoint(hooks);
return {
  withHook: hooks.filter(h => h.hook),
  needCompanyFallback: hooks.filter(h => !h.hook).map(h => ({ name: h.name, company: h.company, reason: h.reason })),
};
```

Everyone in `needCompanyFallback` gets Hook 2 or Hook 3 at the account level, or an
honest merge-field template. **Never let an empty pull turn into a made-up first line.**

**Step 2 — contact enrichment is opt-in and cost-confirmed.** Quote the worst case before
you run it, then run it:

> "Business emails for 40 people: at most ~40 credits (1 per matched person). Adding
> personal emails and phones raises the ceiling to 5 per person, so ~200. Business only —
> go?"

```js
// user query: get business emails for the 40 people on the list (worst case ~40 credits, confirmed)
const urls = inputs.profileUrls;
const batches = chunk(urls, 25); // hard cap: 25 URLs per call
const results = await parallelMap(batches, async (batch) => {
  const r = await callTool("person_contact_enrich", {
    professional_network_profile_urls: batch,
    fields: ["contact.business_emails"], // narrow the request; see the cost note below
  });
  return r.ok ? r.data : batch.map(u => ({ matched_on: u, matches: [], error: r.message }));
});
const rows = results.flat();
return {
  contacts: rows.map(m => ({
    url: m.matched_on,
    email: m.matches?.[0]?.person_data?.contact?.business_emails?.[0]?.email ?? null,
    status: m.matches?.[0]?.person_data?.contact?.business_emails?.[0]?.status ?? null,
  })),
  unmatched: rows.filter(m => !m.matches?.length).map(m => m.matched_on),
};
```

**Omitting `fields` requests all three tiers** (business email, personal email, phone) and
takes the ceiling to 5 credits per matched person. Narrow the whitelist to the tiers you
actually need, and read `credits_remaining` on the response for the real spend. Report
unmatched rows honestly — never pad a list with guessed email patterns.

**Step 3 — hand off.** Two artifacts, no credentials, no auto-send:

- **Campaign CSV**: `email, first_name, last_name, company, title, linkedin_url,
  hook_text, hook_date, hook_url, personalization_line, tier`. The hook, its date, and the
  link to it ride in the file so the rep can sanity-check every row before it sends.
- **Campaign spec** the user pastes into whatever sequencer they run: the sequence steps
  with the full copy per step, the merge fields used, send window and timezone, daily
  ramp (start at 20-30/day on a new domain), threading (follow-ups in-thread), and
  stop-on-reply ON.
- **Deliverability guardrails** in the spec: warmed domain, at most one link in touch 1,
  plain text over HTML, unsubscribe honored instantly.

---

## Rules

- **The hook comes first, and it is real or it is absent.** Never fabricate a post, a
  quote, a round, a mutual connection, or a case study. "I couldn't find a recent signal
  for this person, here's a role-level angle instead" is a valid, honest answer.
- **Date every reference** in the draft and in your notes to the rep, so they can check
  it in five seconds.
- One hook, one idea, one ask per touch. Shorter beats clever.
- **Never auto-send anything.** Email drafts stay drafts. This skill never writes to a CRM; any log entry is yours to make before
  writing. Sequencer setup is a spec plus a CSV that the rep loads and starts themselves.
- **Respect opt-outs completely** and immediately. Never volume your way past a
  compliance limit; if the user wants that, it's theirs to own explicitly.
- **No-slop rule on every deliverable** (full list above): no em dashes, no
  "delve"/"leverage"/"streamline", no filler, nothing that survives a find-and-replace of
  the company name.
- Costs are real: state expected spend before post pulls, list fan-outs, or contact
  enrichment. Every `execute` response carries `credits` and `credits_remaining`;
  `account_credits` (free) reports the balance.
- **Every deliverable ends with the handoff question**: copy in chat, a CSV plus campaign
  spec for your sequencer, or a rendered doc.
- **Adapt the layout to the content — never let it hide anything.** The brand system is
  fixed; the layout is not. If real content doesn't fit — a long company or person name, a
  12-word title, 200 rows — change the layout, not the content: let the card grow, wrap
  instead of truncating, drop to one column, widen the column, raise the cap, or give the
  wide thing its own scroll container. Never solve a fit problem by clipping a card,
  ellipsing a name, or silently dropping rows. Where a cap really is unavoidable, say so
  in the UI ("showing the top 50 of 214"). Look at the rendered output and fix what's cut
  off before you hand it over.
- **Icons in rendered output**: Lucide, the dashboard's icon set, inlined as SVG with a
  `currentColor` stroke. No emojis in artifact UI.
- **Photos and logos are free — use them in rendered output.**
  `basic_profile.profile_picture_permalink` (person) rides in the `basic_profile` group of
  any person record handed to you; `basic_info.logo_permalink` (company) comes
  free from `company_identify` and from `company_enrich`'s `basic_info`. Neither costs an
  extra credit. Base64-inline both as `data:image/jpeg;base64,...` URIs — the media CDN
  serves them as `binary/octet-stream`, so a remote `<img src>` renders blank. Monogram
  fallback when an image is missing.
- **Artifact branding**: copy is chat-native by default, and the CSV stays a plain data
  file — never render an artifact just to render one. But IF a deliverable is rendered as
  a page or document (an objection playbook, a sequence spec, a campaign one-pager), it
  carries the Crustdata brand lockup in the header or footer: a small uppercase
  "Powered by" eyebrow plus the official Crustdata wordmark, linking to crustdata.com.
  The wordmark pair ships in this skill's `assets/` — `crustdata-logo-light.png` (dark
  text, for light backgrounds) and `crustdata-logo-dark.png` (white text, for dark
  backgrounds). Base64-inline the theme-appropriate variant at ~17px height — never
  hotlink; rendered artifacts cannot fetch remote images. Brand accent: `#5547E2`
  (`#8387FF` on dark grounds). Body font: Geist when embeddable, else the system stack.

## Error handling

- **A failed call is the dangerous case, not the obvious one.** `r.ok === false` on a
  post pull looks identical to "this person doesn't post". Branch on it, report it as an
  error, and fall back to Hook 2 or Hook 3 — never let it become a generic first line
  dressed up as personalization.
- **403 naming a field** = a plan-gated projection. Drop that field from `fields` and
  re-run. **403 naming the endpoint** (contact enrichment is the common one) = the plan
  doesn't include it; say so plainly and hand off the list without emails rather than
  guessing address patterns.
- **Empty posts, empty news, no open roles** is a normal outcome, not a failure. Report
  which sources came back empty and take the no-hook path above.
- **`company_identify` returns several matches** for one domain — that's expected, it's
  fuzzy. Take the top `confidence_score`; if two are close, name both and ask.
- **Unmatched rows in a list run** are reported by name, never dropped and never
  silently swapped for a template row.

## Cost cheat sheet

| Call | Cost |
|---|---|
| `company_identify`, autocomplete, `get_schema`, `account_credits` | Free |
| `social_post_list_live` | **1 cr per post** — `limit` is the spend dial |
| `company_enrich` by id + `exact_match: true` | 2 cr for one match |
| `job_search` | ~0.03 cr/result; `limit: 1` + `total_count` ≈ 0.03 cr |
| `person_contact_enrich` | no base charge, billed per contact type returned per matched person (business email 1, personal 2, phone 2), **capped at 5 per person**. Narrowing `fields` sets the worst case but is not a guaranteed cap — a single-tier request has been observed billing the full 5-credit cap and returning all three tiers, so quote 5/person as the ceiling and read `credits_remaining` for the actual spend |
| Writing, classifying, sequencing | Free — it's all model work |

A single well-hooked cold email typically costs 3-5 credits. A 40-person sequence with
hooks and business emails lands around 150-200.

## Works with

- **sales-prospecting** — builds the list and fires the signals this skill writes on.
  Champion-tracker rows are the highest-converting input here.
- **account-research** — deep-dive an account before a big-ticket touch; its account plan
  gives you the pain map the bridge line needs.
- **icp-builder** — writes `config/persona-profile.md` (voice) and `config/gtm-config.md`
  (what you sell) from one LinkedIn URL, so drafts sound like the rep from run one.
- **warm-path-workspace** — when there's a warm route in, use it: a referral opener beats
  the best cold email you'll ever write.

## Tool dependencies

This skill requires:

- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)):
  a single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All Crustdata
  data tools are reached inside an `execute({ code })` plain-JavaScript script via
  `await callTool(name, params)` — author against the typed surface from `get_schema`, but
  the script body carries zero type annotations (a type annotation is a parse error that
  fails the whole run). Tools used here: `social_post_list_live`, `company_identify`,
  `company_enrich`, `job_search`, `person_contact_enrich` (opt-in, cost-confirmed),
  `account_credits`.
- **Nothing else.** No sequencer credentials, no email-sending access, no CRM write
  access. Outbound leaves this skill as copy, a CSV, and a written campaign spec — the
  rep loads and starts it.
