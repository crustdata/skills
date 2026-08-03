---
name: warm-path-workspace
description: Build an interactive Deal Workspace artifact for one or more target accounts - an auto-researched account brief, a buying-group map with deal roles, per-stakeholder dossiers (priorities, talking points, likely objections, a grounded opener) mined from each person's LinkedIn activity, live deal signals, prioritized plays, and a weighted warm-intro chain map that traces every route from your team's LinkedIn connections through real named intermediaries to the decision makers, ranked by how short and strong each route is. Use this whenever someone points at a company or list of companies and wants to know who to sell to and how to get in - especially if they mention or upload LinkedIn Connections.csv exports, or say things like "who do we know at X", "map our warm intros", "who are the decision makers at X", "build a stakeholder map", "find the warmest path into X", "multithread this account", or want account research turned into something shareable with their team. Trigger it even when they only say "research this account" or "help me get a meeting at X" - the warm-path mapping is the whole point.
---

# Warm-Path Deal Workspace

Turn "here is a company, here are our LinkedIn connections" into one self-contained,
shareable HTML workspace that answers two questions an account team actually has: **who
decides**, and **who do we already know who can get us to them**.

Most stakeholder maps stop at the first question. The second is where deals are won, and it
is the part people fake - they draw a line from every connection straight to the buyer, which
makes an intern look as valuable as a VP. This skill scores every route instead, so the
operator spends their scarcest resource (a teammate's willingness to make an ask) on routes
that will actually land.

## What gets built

One HTML file, published with the `Artifact` tool, with a tab set per account and an account
switcher on top when there is more than one:

| Tab | Contents |
|---|---|
| Overview | Account brief, headcount and funding tiles, hiring-signal chart, recent activity |
| Stakeholders | Buying group grouped by deal role; each card opens a drawer with the LinkedIn deep dive, priorities, talking points, objections, a copy-ready opener, notable posts, career timeline - every claim behind an evidence dropdown |
| Relationship Map | YOU → warm connection → named intermediary → decision maker, colour and thickness weighted by route strength, plus a ranked chain list |
| Signals | Hiring surges, job changes, intent posts, funding, newest first |
| Plays | 3-6 prioritized moves, each citing the signal or path behind it |

## Inputs

Ask only for what is missing.

| Input | Required | Default |
|---|---|---|
| Target account(s) | yes | - |
| LinkedIn connection export(s) | no, but the point of the skill | skip warm paths, say so |
| Seller company + one-line product | no | infer from context |
| Deal stage | no | "Prospecting" |
| Depth | no | 6-8 stakeholders per account |

Exports arrive as a bare `Connections.csv`, an unzipped `Basic_LinkedInDataExport_*` folder,
or the raw `.zip`. All three work. When the export contains `Profile.csv` the owner's name is
read from it automatically - do not ask the user who each file belongs to when the file
already says. Confirm the detected names back to them, because attributing a connection to the
wrong teammate sends the intro request to the wrong person.

## Phase 0 - preflight and an isolated working directory

Create a **run-scoped** working directory and use it for everything:

```bash
WORK="$(mktemp -d -t wpw)"   # or <somewhere>/wpw-<account>-<timestamp>
mkdir -p "$WORK"
```

This matters more than it looks. Two runs sharing a scratch path will clobber each other's
`connections.json`, and the failure is silent: in testing one run briefly reported that an
owner had zero connections at an account when they had ten thousand. Cross-owner
contamination is the worst corruption this tool can produce, because the operator ends up
asking the wrong teammate for an intro to someone they have never met. One directory per run,
always.

Then check Crustdata is reachable and surface the balance in one line. All Crustdata calls in
this skill run through the Code Mode MCP ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)):
plain-JavaScript `execute({ code })` scripts calling `await callTool(name, params)` — every
script opens with a `// user query: ...` or `// model query: ...` comment, branches on `r.ok`,
and returns only the compact projection it needs (`fields` is a response whitelist: the result
carries only the groups you list). The preflight is `account_credits` (free):

```js
// model query: preflight - Crustdata reachable + credit balance
const r = await callTool("account_credits", {});
return r.ok ? r.data : { error: r.message };
```

## Phase 1 - account brief (per account)

`company_identify` (free) to resolve the company — it is fuzzy, one identifier can match
several companies, so take the top `confidence_score` match — then one `company_enrich` by
`crustdata_company_ids` with `exact_match: true` and `fields: ["basic_info", "headcount",
"funding", "competitors", "people", "news", "hiring", "followers", "taxonomy"]` (the `people`
group carries the decision-maker and CXO snapshot; list every group you read). Then
`job_search` twice - `limit: 0` with a `group_by` aggregation on `job_details.category` for
the aggregate, then `limit: 15` sorted by `metadata.date_added` desc for notable roles. Then
`social_post_list_live` on the company (`company_domain`; 1 credit per post, so set `limit`
deliberately — ~10 is plenty for the brief).

**Check whether the account still exists as an independent company.** Acquisitions change who
holds budget and which brand people list. A recent deal belongs in the brief and in the alias
list. In testing, Confluent turned out to be an IBM company mid-run, which changed the entire
buying process.

Write a 3-4 sentence `brief`: what they do, their scale, what is changing, why now. Ground
every number in the payload you just pulled.

**Take the logo while you are here.** `basic_info.logo_permalink` comes back from the free
`company_identify` call (and from the enrich above) at no extra credit cost. Download it,
base64 it, and write it to `account.logo_url` as a `data:image/jpeg;base64,...` URI - the
media CDN serves these as `binary/octet-stream`, so a remote `<img src>` renders blank. The
workspace shows it in the header and the account switcher; without it you get a monogram.

## Phase 2 - buying group

Seed with contacts the user named plus the `people` group from Phase 1, then discover with
`person_search` filtered on `experience.employment_details.current.company_id` and senior
`experience.employment_details.current.seniority_level`, biased to the function you sell
into. Resolve enum values with `person_autocomplete` first - a wrong enum silently returns
zero rows (the seniority vocabulary is a closed set: `CXO`, `Vice President`, `Director`,
`Experienced Manager`, `Strategic`, ...).

**Then run a second pass on stack ownership, not title.** Seniority is a proxy for authority;
owning the budget and the tools is the real thing. Search for people whose title or headline
says they own the relevant systems (ops, platform, systems, enablement, tooling, "GTM
systems", "talent operations"). In testing the single best-fit buyer at one account was a
*Senior Manager* who owned 18 tools and a $5M budget, and a director-and-above sweep missed
him entirely.

Trim to 6-8 people. Assign a provisional `deal_role` and `influence` (1-5). Set `entity` when
someone sits in an acquired sub-brand rather than the parent - that is what lets a connection
at that sub-brand route straight to them.

**Acquisitions are where the warm paths hide.** People at acquired companies often still list
the original brand, so a connection at "Red Hat" never matches a search for "IBM". Web-search
the acquisition history and write the full alias list to `aliases.json`:

```json
{"IBM": ["ibm", "red hat", "hashicorp", "apptio", "nordcloud"]}
```

Multi-word aliases match as phrases, single words as whole tokens, so fragments like "edge"
will not drag in unrelated firms. Watch for genuine collisions - "Observe.AI" is not the
"Observe, Inc." that Snowflake bought, and both will appear.

## Phase 3 - stakeholder deep dives

Spawn one sub-agent per stakeholder, batched in a single message, using
`references/stakeholder-agent.md`. Keep raw post dumps out of the main context. Assemble into
`$WORK/<slug>/dossier.json` following `references/dossier-schema.md`.

Each person's photo (`basic_profile.profile_picture_permalink`) is already inside the
`basic_profile` group the sub-agent requests - free. Base64 it into `photo_url` on the
stakeholder, same `binary/octet-stream` rule as the logo. Cards and drawers look like a real
buying group instead of a wall of initials.

## Phase 4 - connections, bench, and verification

```bash
python3 scripts/parse_connections.py --out "$WORK/connections.json" \
  --input "/path/Connections.csv" \
  --input "/path/Basic_LinkedInDataExport_2026.zip"     # append ':Name' to override the owner
```

Report per-owner totals back to the user. Then **verify the bench before presenting it as
live routes.** Exports carry the employer as of export day and go stale silently - in testing
one bench member had already left the account. Spot-check the matched rows with
`person_enrich` (`fields: ["basic_profile", "experience"]`) and drop or flag anyone who has
moved on.

Two blind spots are structural, cheap to state, and worth stating rather than shipping a map
that merely looks complete:
- connections with a **blank company field** match no alias and are invisible
- **ex-employees are invisible** - the export carries current employer only, so someone who
  spent a decade at the target and just left will never appear despite being an ideal broker

## Phase 5 - route resolution

Read `references/chain-scoring.md` for the model and the honesty constraints. Three kinds of
route exist, best first, and the builder detects the first two automatically:

1. **Zero hop** - the connection *is* a member of the buying group. Nothing beats this and it
   is easy to miss, because the bench and the buying group are built by different phases. The
   builder matches on LinkedIn URL then name; you get it for free.
2. **Date-verified shared history** - the connection and a stakeholder worked at the same
   company at overlapping times. This is the strongest evidenced bridge available, but only if
   the dates actually overlap: of 13 apparent "we both worked at X" ties in testing, **only 3
   survived the date check** - the rest joined after the target had left. To enable it, enrich
   the bench members' work history and write `careers.json`:
   ```json
   {"https://www.linkedin.com/in/someone": [{"company": "Red Hat", "start": "2021-03", "end": "2023-08"}]}
   ```
   Keyed by LinkedIn URL or lowercase name. The builder does the date arithmetic and records
   non-overlapping pairs as documented dead ends so nobody rediscovers them.
3. **Org-layer bridge** - everyone else. Resolve the senior leader of each function present in
   the bench, one `person_search` per (account, function) rather than per connection, and
   write `intermediaries.json`:
   ```json
   {"Acme": {"Engineering": [{"name": "...", "title": "VP, Platform Engineering",
                              "linkedin_url": "...",
                              "basis": "most senior Engineering leader at Acme (person_search, seniority=VP)"}]}}
   ```
   Always fill `basis` with how you found them and why they qualify. Reporting lines are not in
   the data, so never phrase a basis as a confirmed manager relationship.

## Phase 6 - signals and plays

Assemble `signals[]` from the hiring surge, the buying signals the sub-agents surfaced, job
changes, funding and recent news, newest first with a severity. Then write 3-6 `plays[]`
naming the connection, the intermediary and the decision maker, citing the signal that makes
now the moment. "Reach out to the team" is not a play.

## Phase 7 - build and publish

```bash
python3 scripts/build_workspace.py \
  --dossier "Acme=$WORK/acme/dossier.json" \
  --dossier "Globex=$WORK/globex/dossier.json" \
  --connections "$WORK/connections.json" \
  --aliases "$WORK/aliases.json" \
  --intermediaries "$WORK/intermediaries.json" \
  --careers "$WORK/careers.json" \
  --template assets/workspace-template.html \
  --title "Acme + Globex Deal Workspaces" \
  --out "$WORK/workspace.html"
```

The builder does all the deterministic work: matching connections to accounts, detecting
zero-hop and shared-history routes, scoring and ranking every chain, wiring in intermediaries,
recording dead ends, and injecting the data. Check its printed summary - warm counts, strong
counts, zero-hop, verified ex-colleague, named org layers - before publishing.

Then **publish it**. Load the `artifact-design` skill (required before the first `Artifact`
call), then call `Artifact` with `file_path` = `$WORK/workspace.html`, a stable title, a
one-sentence description and a favicon. The artifact is the deliverable; a workspace left on
disk helps nobody. Re-publishing the same file path redeploys to the same URL, which is what
makes iteration cheap.

Report the headline numbers: stakeholders mapped, posts analysed, warm chains and how many are
strong, zero-hop routes, signals, plays.

## Phase 8 - iterate

Common follow-ups: add a teammate's export and rebuild, add or re-run a stakeholder, change a
deal role, widen the buying group. Each edits the inputs and re-runs Phase 7 to the same URL.

## Guardrails worth holding

**Never fabricate, and make the artifact prove it.** Every claim carries evidence citing the
payload it came from; unevidenced claims go in `gaps`. The evidence dropdowns are why anyone
trusts the page, and one confident invention undoes them all.

**"No strong chains" is a success, not a failure.** If the team's network does not reach the
buying function, say so plainly and call the account warm-*assisted* outbound. Dressing up
four weak chains as a way in wastes real social capital. In testing both an unaided run and a
skill run reached that verdict independently on the same account, which is the system working.

**Watch for name collisions.** Company names are not unique and people share names. Verify a
match is the right entity before it reaches the bench, and drop procurement "strategic
sourcing" roles when you are looking for talent sourcing.

**House style for anything sendable.** Openers and talking points get pasted into real emails:
no em dashes or en dashes, and no legal-entity suffixes in company names.

**Adapt the layout to the content - never let it hide anything.** The brand system below is
fixed; the layout is not. If real content does not fit - a long company or person name, a
12-word title, 40 stakeholders, more chains than the graph can plot - change the layout, not
the content: let the card grow, wrap instead of truncating, drop to one column, widen the
column, raise the cap, or put the wide thing in its own scroll container. Never solve a fit
problem by clipping a card, ellipsis-ing a name, or silently dropping rows. Where a cap really
is unavoidable, say so in the UI ("showing the 18 strongest of 34 routes") so the reader knows
what they are not seeing. Look at the rendered page (Phase 7's self-review) and fix what is cut
off before you hand it over.

**Crustdata branding on rendered artifacts.** The bundled workspace template carries the real
Crustdata brand system - keep it, and never strip it when editing the template:

- **Wordmark**: the official pair ships in this skill's `assets/` - `crustdata-logo-light.png`
  (dark text, for light backgrounds) and `crustdata-logo-dark.png` (white text, for dark),
  the same files app.crustdata.com's header renders. Base64-inline the theme-appropriate
  variant at ~17px tall, linking to crustdata.com; the template shows both and switches them
  in CSS. Never hotlink a logo - rendered artifacts cannot fetch remote images.
- **Color**: brand purple `#5547E2` (the product's primary) as the accent; `#8387FF` (the
  product's own lightened purple) as the dark-theme accent.
- **Type**: Geist, the product font, embedded as a data-URI `@font-face` with the system
  stack as fallback.
- **Icons**: Lucide, the dashboard's icon set, inlined as SVG with a `currentColor` stroke
  (the template's `licon()` helper holds the path data). No emojis in artifact UI.

Any OTHER page or document this skill renders (a one-off summary page, an exported report)
carries the same system: base64-inline the wordmark pair from `assets/` behind a "Powered by"
eyebrow, and copy the `@font-face`, the accent variables, and the `licon()` icon helper from
`assets/workspace-template.html`. This is conditional: chat output and
data files stay unbranded, and nothing gets rendered as an artifact just to carry the mark.

## Tool dependencies

- **Crustdata MCP server** ([install.crustdata.com/mcp](https://install.crustdata.com/mcp)): a
  single Code Mode MCP exposing `list_tools`, `get_schema`, and `execute`. All Crustdata data
  tools are reached inside an `execute({ code })` plain-JavaScript script via
  `await callTool(name, params)` — author against the typed surface from `get_schema`, but
  write zero type annotations in the body. Tools used here: `company_identify`,
  `company_enrich`, `person_search`, `person_autocomplete`, `person_enrich`,
  `person_contact_enrich`, `job_search`, `social_post_list_live`, `web_search_live` (alias
  research), `account_credits`
- **Python 3** for `scripts/parse_connections.py` and `scripts/build_workspace.py` (pure local
  processing, no network calls)
- **Artifact tool** for publishing the workspace HTML

## Bundled resources

- `scripts/parse_connections.py` - normalises LinkedIn exports, auto-detects owner from Profile.csv
- `scripts/build_workspace.py` - bench matching, zero-hop and shared-history detection, chain scoring, HTML injection
- `assets/workspace-template.html` - the self-contained multi-account workspace renderer
- `references/dossier-schema.md` - the per-account dossier contract; read before writing one
- `references/stakeholder-agent.md` - the deep-dive sub-agent prompt; read before Phase 3
- `references/chain-scoring.md` - how routes are scored and resolved honestly; read before Phase 5
