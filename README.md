# Crustdata Skills

Open-source skills for [Claude.ai](https://claude.ai), [Claude Desktop](https://claude.ai/download), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills) — powered by [Crustdata](https://crustdata.com)'s real-time B2B data APIs. Each skill is a ready-to-use AI workflow for sales, recruiting, and growth tasks. No coding required.

## Skills

| Skill | What it does |
|-------|-------------|
| [Email Enrichment](./skills/email-enrichment/) | Turn a list of names into verified business and personal emails |
| [Candidate Sourcing](./skills/candidate-sourcing/) | Go from "I need to hire for role X" to personalized Gmail drafts ready to send |
| [Sales Prospecting](./skills/sales-prospecting/) | Build target lists, rank your accounts, size your market, track champions who move |
| [Account Research](./skills/account-research/) | Know a company before you sell to it: account plan, org chart, tech stack, battlecard |
| [ICP Builder](./skills/icp-builder/) | Paste one LinkedIn URL, get your persona, ICP, and voice as reusable config |
| [Warm-Path Deal Workspace](./skills/warm-path-workspace/) | Map who decides at an account and who on your team can reach them |

*More skills coming soon.*

---

## Getting started

Every skill works with **Claude.ai** (web), **Claude Desktop** (macOS/Windows app), and **Claude Code** (CLI). Pick your platform:

### Claude.ai — web, no install

1. **Get a Crustdata API key** at [crustdata.com](https://crustdata.com)
2. **Add Crustdata** — go to [Settings → Connectors](https://claude.ai/settings/connectors) → click "Add custom connector" → paste `https://install.crustdata.com/mcp` → click "Add". ([Step-by-step guide with screenshots](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. **Connect Gmail** (for skills that send emails) — Gmail is already listed in your Connectors. Just click "Connect" next to it
4. **Upload a skill** — download the `.skill` file from [Releases](https://github.com/crustdata/skills/releases) and upload it to your project

### Claude Desktop — macOS / Windows app

1. **Get a Crustdata API key** at [crustdata.com](https://crustdata.com)
2. **Add Crustdata** — open Settings → Connectors → "Add custom connector" → paste `https://install.crustdata.com/mcp` → click "Add". Same flow as Claude.ai. ([Step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp))
3. **Connect Gmail** — find Gmail in your Connectors list and click "Connect"
4. **Upload a skill** — download the `.skill` file from [Releases](https://github.com/crustdata/skills/releases) and upload it to your project

### Claude Code — install the plugin

**1. Install** from the Crustdata marketplace:

```bash
claude plugin marketplace add crustdata/skills
claude plugin install crustdata@crustdata-plugin
```

This adds the Crustdata MCP server (800M+ profiles, 200M+ companies) and the bundled research skills.

**2. Sign in — once.** The first time Claude uses a Crustdata tool it asks you to connect. You can also do it up front: run `/mcp`, pick **crustdata**, and choose **Authenticate**. Your browser opens, you sign in, and Claude handles the rest. There's no API key to paste and no command to remember — Claude stores the connection and reuses it in every session.

**Platform support.** The plugin is pure Node (no shell scripts, no native deps) and works the same on **macOS, Linux, Windows, and WSL**:

- Requires **Node ≥ 22** on your `PATH` (the plugin's session hook runs via `node`).
- Sign-in is handled by Claude itself, so it works wherever Claude Code does.
- Skill sync writes only inside the plugin's own directory, on every OS.

---

## Email Enrichment

> Bulk email finder for B2B contact enrichment. Find business emails and personal emails from a list of names, LinkedIn profiles, or a spreadsheet.

**Input:** A list of people — names, companies, LinkedIn URLs, or an .xlsx/.csv spreadsheet

**Output:** Verified business emails + personal emails, added as new columns

### Before & After

```
BEFORE:                                    AFTER:
┌──────────────┬─────────────┐             ┌──────────────┬─────────────┬─────────────────────┬──────────────────────┐
│ Name         │ Company     │             │ Name         │ Company     │ Business Email      │ Personal Email       │
├──────────────┼─────────────┤             ├──────────────┼─────────────┼─────────────────────┼──────────────────────┤
│ Ada Whitlock │ Northwind   │    ──►      │ Ada Whitlock │ Northwind   │ ada@northwind.example│ a.whitlock@example…  │
│ Ravi Desai   │ Lumen Labs  │             │ Ravi Desai   │ Lumen Labs  │ ravi@lumenlabs.exam… │ ravi.desai@example…  │
│ Mei Tanaka   │ Harbor VC   │             │ Mei Tanaka   │ Harbor VC   │ mei@harborvc.example │ —                    │
└──────────────┴─────────────┘             └──────────────┴─────────────┴─────────────────────┴──────────────────────┘
```

### How it works

1. **Resolves identities** — matches names + companies to LinkedIn profiles via Crustdata's 1B+ person database
2. **Finds business emails** — enriches profiles in batches using Crustdata's people enrichment API
3. **Finds personal emails** — uses Crustdata's web search API with smart multi-source discovery

Unlike Apollo, Hunter.io, Clearbit, ZoomInfo, People Data Labs, Coresignal, Lusha, RocketReach, Exa, or Parallel — this runs entirely inside Claude as an AI-native workflow. No GUI, no manual CSV uploads, no per-seat pricing. Just describe what you need.

### Use cases

- **Sales prospecting** — enrich lead lists with verified business emails for cold outreach
- **Recruiting** — find personal emails for engineering candidates you want to reach directly
- **Investor outreach** — build contact lists for fundraising from conference attendee lists
- **Event follow-up** — turn a spreadsheet of people you met into actionable contacts

### Try it

Just ask Claude: *"Find emails for these people: [paste your list]"*

[Full documentation and evals →](./skills/email-enrichment/)

---

## Candidate Sourcing

> AI-powered candidate sourcing for founders and hiring managers. Find engineers, verify their LinkedIn profiles, enrich emails, write personalized outreach, and create Gmail drafts — all in one workflow.

**Input:** A role description — what you're hiring for, what technical problems matter, any target companies or communities

**Output:** Gmail drafts ready to send, each with a personalized opener referencing the candidate's specific work

### Before & After

```
YOU SAY:                                   YOU GET:
┌─────────────────────────────────┐        ┌──────────────┬───────────┬─────────────────────────────────────┬──────────┐
│ "Find 5 ML engineers who've     │        │ Candidate    │ Company   │ Why them                            │ Status   │
│  published on RAG. Prioritize   │  ──►   ├──────────────┼───────────┼─────────────────────────────────────┼──────────┤
│  startups over FAANG. Draft     │        │ Jane Chen    │ Cohere    │ First author on RAG benchmark paper │ Draft ✓  │
│  outreach for our Founding ML   │        │ Raj Patel    │ Pinecone  │ Built RAG eval toolkit (2.3K stars) │ Draft ✓  │
│  Engineer role."                │        │ Maria Lopez  │ Weaviate  │ Led vector search, MLOps speaker    │ Draft ✓  │
└─────────────────────────────────┘        └──────────────┴───────────┴─────────────────────────────────────┴──────────┘
```

### How it works

1. **Finds candidates** — searches Crustdata's 1B+ person database, arXiv, GitHub, and the web for people matching your specific criteria
2. **Verifies LinkedIn** — waterfall lookup through Crustdata, never guesses URLs (guessed URLs caused 12 errors in a real 91-person campaign)
3. **Finds emails** — business emails via Crustdata enrichment, personal emails via Crustdata web search
4. **Writes personalized outreach** — each email references the candidate's specific work, not job titles
5. **Creates Gmail drafts** — ready to review and send, with a CSV tracker for pipeline management

Unlike Juicebox, HireEZ, SeekOut, LinkedIn Recruiter, or traditional recruiters ($15-30K per hire) — you define the ranking criteria, you see every step, and you pay per use. No black-box algorithm deciding who's "best."

### Use cases

- **Seed/Series A founders** sourcing their first engineers without a recruiter
- **Hiring managers** who want to own top-of-funnel instead of waiting on recruiters
- **Technical founders** who know what "good" looks like and want to define their own ranking
- **Anyone tired of Juicebox** surfacing the same senior FAANG engineers that every other startup is pitching

### Try it

Tell Claude: *"I need to hire a [role]. Find candidates and set up outreach."*

[Full documentation and evals →](./skills/candidate-sourcing/)

---

## Sales Prospecting

> B2B lead list building and account prioritization. Build a target list from your ICP, rank the accounts you already have, or find companies that look like your best customers.

**Input:** Your ICP, a list of accounts, a customer list, or a conference name

**Output:** A ranked list scored on fit, timing, and warmth, with the signal and its date on every row

### Before & After

```
YOU SAY:                                 YOU GET:
┌───────────────────────────────┐        ┌──────────────┬───────────────────────────────┬───────┐
│ "Rank my accounts — who do    │        │ Account      │ Why now (dated evidence)      │ Score │
│  I work first this week?      │  ──►   ├──────────────┼───────────────────────────────┼───────┤
│  northwind.example,           │        │ Lumen Labs   │ Series B Jun 12, +31% HC 12mo │ HOT   │
│  lumenlabs.example, ..."      │        │ Harbor Foods │ 9 new eng roles posted Jun 28 │ WARM  │
└───────────────────────────────┘        │ Northwind    │ Last raise Mar 2024, flat HC  │ COLD  │
                                         └──────────────┴───────────────────────────────┴───────┘
```

### How it works

1. **Starts with your goal** — asks what you're trying to do, then picks the play: net-new list, lookalikes, account ranking, event prospecting, expansion, market sizing, or champion tracking
2. **Searches and narrows** — filtered queries against Crustdata's company, people, and job APIs, with a note on what each round caught and dropped
3. **Scores and hands off** — ranks every row on fit, timing, and warmth, shows the evidence and its date, then exports to a spreadsheet or CSV

### Use cases

- **Account executives** — paste your book, get the five accounts to work this week and the reason for each
- **Founders doing their own prospecting** — turn an ICP into a target list without a data seat or a sales ops team
- **Customer success teams** — spot new funding, new execs, and open roles inside accounts you already have
- **Sales leaders** — bottom-up market sizing from real company counts, with the filters behind every number

### Try it

Just ask Claude: *"Rank my accounts and tell me who to work first this week."*

[Full documentation and evals →](./skills/sales-prospecting/)

---

## Account Research

> Account research and account planning for sales teams. Get an account plan, an org chart, a tech-stack read, or a competitive battlecard for any company.

**Input:** A company name or domain, plus what you sell. If your CRM, call recorder, team chat, or email is connected, it reads those too

**Output:** One of four deliverables — an account plan, an HTML org chart, a tech-stack map, or a battlecard — with a source on every fact

### Before & After

```
YOU SAY:                                 YOU GET:
┌───────────────────────────────┐        ┌─────────────┬─────────────────────────────────┬───────────┐
│ "Account plan for Northwind.  │        │ Section     │ What lands in the plan          │ Source    │
│  We sell data-quality tooling │  ──►   ├─────────────┼─────────────────────────────────┼───────────┤
│  to engineering teams."       │        │ Signals     │ +18% headcount, $85M Series C   │ Crustdata │
└───────────────────────────────┘        │ Why we win  │ 9 of 34 roles mention pipelines │ Job posts │
                                         │ Who to call │ Priya Raman, VP Data Platform   │ LinkedIn  │
                                         │ Our history │ Eval stalled in Q3              │ Your CRM  │
                                         │ Entry play  │ Open on the pipeline gap        │ Inference │
                                         └─────────────┴─────────────────────────────────┴───────────┘
```

### How it works

1. **Reads your context** — asks what you sell and which of your own tools are connected: CRM, call recorder, team chat, email. All read-only
2. **Pulls the outside view** — firmographics, headcount growth, funding, news, open roles, the company's own posts, and the leadership layer, through Crustdata's company, people, job, and web search APIs
3. **Writes the deliverable** — account plan, org chart, stack map, or battlecard, with a source on every fact and every inference labeled as one

### Use cases

- **Account executives** — walk into a first call knowing their funding, their hiring, and what already happened between your two teams
- **Founders selling into enterprise** — see who runs the company and who reports to whom before you pick a champion
- **Sales leaders** — hand the team a battlecard that names a competitor's real strengths, not just their gaps
- **Solutions engineers** — find out which tools an account already runs before you scope the deal

### Try it

Just ask Claude: *"Account plan for northwind.example. We sell data quality tooling to engineering teams."*

[Full documentation and evals →](./skills/account-research/)

---

## ICP Builder

> Paste one LinkedIn URL and get your setup: who you are, what you sell, your ideal customer profile, and your writing voice.

**Input:** One LinkedIn URL — your own

**Output:** Two config files — your persona profile and your ICP — that the other skills read before they run

### Before & After

```
YOU PASTE:                               YOU GET:
┌───────────────────────────────┐        ┌───────────┬─────────────────────────────────────────────┐
│                               │        │ Section   │ What gets written                           │
│ linkedin.com/in/adawhitlock   │  ──►   ├───────────┼─────────────────────────────────────────────┤
│                               │        │ Identity  │ Ada Whitlock, VP Sales at Northwind Data    │
└───────────────────────────────┘        │ We sell   │ Product analytics for mobile teams          │
                                         │ ICP       │ Consumer apps, 51-500, Series A+ (inferred) │
                                         │ Buyers    │ VP Product, Head of Growth                  │
                                         │ Voice     │ Direct, short sentences, first person       │
                                         └───────────┴─────────────────────────────────────────────┘
```

### How it works

1. **Reads your profile** — Crustdata's person enrichment API turns the URL into your name, title, company, tenure, and past roles
2. **Works out what you sell** — Crustdata's company enrichment API describes your product and category, and the ICP follows from it: industries, headcount, geography, funding stage, buyer titles
3. **Reads your voice** — Crustdata's social posts API supplies tone and topics, then both files are written to your working directory

### Use cases

- **First-time setup** — configure every skill here from one URL instead of a questionnaire
- **Founders who sell** — turn your own profile into a working ICP before you build a list
- **Small sales teams** — give each rep a persona profile so outreach sounds like them, not a template
- **Refining a guess** — the ICP is labeled inferred and shown back for correction, so you edit instead of starting blank

### Try it

Just ask Claude: *"Set me up — my LinkedIn is linkedin.com/in/yourname"*

[Full documentation and evals →](./skills/icp-builder/)

---

## Warm-Path Deal Workspace

> Warm intro finder for B2B sales. Find who decides at a target account and which of your team's LinkedIn connections can reach them.

**Input:** A target account, plus your team's LinkedIn connection exports — a `Connections.csv` or the full export zip

**Output:** One shareable HTML page: the account brief, the buying group with a dossier per person, and every warm-intro route scored and ranked

### Before & After

```
YOU HAVE:                                YOU GET:
┌───────────────────────────────┐        ┌──────────────────────────────────────────────────┬──────────┐
│ Account: Northwind Systems    │        │ Route                                            │ Strength │
│ Exports: you + Mei,           │  ──►   ├──────────────────────────────────────────────────┼──────────┤
│ 3,412 connections             │        │ Mei → Dana Fox (ex-colleague) → Sam Ortiz, CTO   │ Strong   │
│ Stage: Prospecting            │        │ You → Chris Lee → Jordan Kim, VP Ops             │ Medium   │
└───────────────────────────────┘        │ You → Alex Ruiz, analyst in another function     │ Weak     │
                                         └──────────────────────────────────────────────────┴──────────┘
```

### How it works

1. **Researches the account** — firmographics, funding, hiring, decision makers, and recent posts from Crustdata's company and people APIs, then writes the brief and picks the buying group
2. **Maps your network onto it** — reads the connection exports on your machine, matches them to the account and its subsidiaries, then checks each match against Crustdata's people API so stale rows drop out
3. **Scores every route** — ranks each path from a teammate through named intermediaries to a decision maker by how short and how strong it is, then publishes the page with evidence behind every claim

### Use cases

- **Account executives** — see who decides at a named account and which teammate can open the door
- **Founders without a network at the account** — turn a logo on your target list into a specific intro to ask for
- **Deal teams multithreading** — one page the whole team opens, with a dossier and an opener for each stakeholder
- **SDRs planning outbound** — know before writing whether the account is warm or cold

### Try it

Just ask Claude: *"Who do we know at Northwind Systems? Here are our LinkedIn exports."*

[Full documentation and evals →](./skills/warm-path-workspace/)

---

## Contributing

Each skill lives in its own directory:

```
skills/
├── email-enrichment/
│   ├── SKILL.md          # Skill definition (the AI reads this)
│   ├── README.md         # Human-readable docs
│   └── evals/
│       └── evals.json    # Test cases for benchmarking
└── candidate-sourcing/
    ├── SKILL.md
    ├── README.md
    └── evals/
        └── evals.json
```

## License

MIT — see [LICENSE](./LICENSE).

---

Built on [Crustdata](https://crustdata.com) — the public data layer for AI and humans.
