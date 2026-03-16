# CLAUDE.md — Crustdata Skills Repository

## What this repo is

A public-facing collection of skills for Claude (claude.ai, Claude Desktop, and Claude Code) powered by Crustdata's APIs. Each skill is a self-contained AI workflow for a specific task (email enrichment, candidate sourcing, deal research, etc.). The primary audience is **prosumer users** — individuals and small teams who want enterprise-grade data workflows without writing code.

This repo is a marketing and distribution asset. Every file a visitor sees must be polished, accurate, and immediately useful.

## Writing voice

Every word earns its place or gets cut. No filler, no fluff, no "leverage our cutting-edge solution." Write like you're explaining it to a smart friend who's busy.

- **Lead with what it does, not what it is.** "Turn a list of names into verified emails" beats "An AI-powered email enrichment solution."
- **One idea per sentence.** If a sentence has "and" in it, it's probably two sentences.
- **Concrete over abstract.** Show a before/after table. Don't say "powerful" — show the power.
- **Simple words win.** "Use" not "utilize." "Find" not "discover." "Get" not "obtain."
- **Cut ruthlessly.** If removing a word doesn't change the meaning, remove it. If removing a sentence doesn't weaken the section, remove it.
- **Setup instructions = recipe steps.** Number them. Each step is one action. A non-technical user should never wonder "what do I click next?"
- **No marketing speak.** No "seamlessly", "effortlessly", "cutting-edge", "best-in-class", "robust". These words mean nothing. Say what it actually does.

The README is a product page, not a press release. A plumber who just started using Claude should be able to read it and know exactly what they'll get and how to set it up.

## Brand context

- **Crustdata** is the public data layer for AI and humans — real-time B2B data via API
- **Positioning**: AI-native alternative to Apollo, Hunter.io, Clearbit, Lusha, RocketReach, ZoomInfo, People Data Labs, Coresignal, Exa, Parallel
- **Tone**: Community-first, open-source feel. Crustdata is the data source powering the skills, not the hero. No hard CTAs, no pricing mentions, no "sign up now" language
- **MCP server URL**: `https://mcp.crustdata.com/mcp` — this is the only correct link. Never use `www.crustdata.com` or any other URL for the MCP server

## Adding a new skill — full checklist

### 1. Name the skill for SEO

The skill folder name becomes the URL path (`github.com/crustdata/skills/tree/main/<name>`). Choose it carefully:

- **Research competitors first.** Search what Apollo, Hunter.io, Clearbit, Lusha, RocketReach, ZoomInfo, People Data Labs, Coresignal, Exa, and Parallel call this category. Use multiple sources to find the highest-intent term:
  - **Google Trends** — compare search interest across candidate keywords
  - **Ahrefs** — check keyword difficulty, search volume, and what competitors rank for. Use browser automation (Chrome CDP skill) to pull data from ahrefs.com if you have access
  - **SimilarWeb** — analyze competitor traffic sources and top organic/paid keywords driving visits. Use browser automation to pull data from similarweb.com
  - **Web search** — look at competitor landing page titles, H1s, and meta descriptions to see which terms they optimize for
  - **Crustdata web search** — `crustdata_web_search` for quick competitive keyword checks
- **Use the industry-standard noun phrase**, not a verb or internal codename. Examples: `email-enrichment` (not `contact-email-enricher`), `candidate-sourcing` (not `find-engineering-candidates`), `deal-research` (not `gtm-deal-copilot`)
- **Keep it short** — 1-3 words, hyphenated, lowercase
- **Match how people search.** If someone would Google "email enrichment tool", the folder should be `email-enrichment`

### 2. Write the SKILL.md

This is what the AI reads. It can contain internal implementation details (techniques, API patterns, fallback chains) that you do NOT want in the public README.

- Update the `name:` field in frontmatter to match the folder name
- Include the MCP server URL (`https://mcp.crustdata.com/mcp`) in the tool dependencies section
- **Never expose proprietary techniques in the README** — keep them in SKILL.md only. Example: GitHub commit history extraction for personal emails is documented in SKILL.md but the README just says "Crustdata's web search API with multi-source discovery"

### 3. Write the skill-level README.md

This lives inside the skill folder (e.g., `email-enrichment/README.md`). It's the human-readable documentation for this specific skill.

**Required sections:**
- **Title + one-liner** — what it does in one sentence, mentioning Crustdata
- **What it does** — bullet points: what inputs it takes, what outputs it produces
- **Example** — before/after table showing real input and output. This is the most important section for non-technical users. They need to see exactly what they'll get
- **How it works** — 3 numbered steps max. Attribute everything to Crustdata APIs. Never mention internal techniques (GitHub commit scraping, Codeforces, etc.)
- **Setup** — two subsections: "Claude.ai or Claude Desktop" first (same steps for both), then "Claude Code (CLI)". Non-technical users come first
- **Evals** — link to the evals.json file

**Setup instructions must link to an actual release.** If the `.skill` file doesn't exist in Releases yet, create the release before pushing the README. Never link to a Releases page that has nothing to download.

**Setup wording rules (Claude.ai and Claude Desktop):**

Claude.ai (web) and Claude Desktop (macOS/Windows app) use the same connector system. The setup steps are identical — combine them under one heading: "Claude.ai (web) or Claude Desktop (macOS/Windows)".

- **Never say "MCP server"** to non-technical users. They don't know what MCP means. Say "custom connector" instead
- **Adding Crustdata**: "Go to Settings → Connectors → 'Add custom connector' → paste `https://mcp.crustdata.com/mcp` → click 'Add'". Always link the [step-by-step guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp)
- **Gmail, Google Drive, Slack, etc. are built-in connectors** — never say "add Gmail MCP". Just say "find Gmail in your Connectors list → click 'Connect'"
- **Only Crustdata requires the custom connector flow** because it's not a pre-built integration
- **Every step is one action.** "Go to X → click Y → paste Z → click Add." No compound steps

### 4. Update the repo-level README.md

The repo README is a **skills catalog**, not a landing page for any single skill.

- **Add one row** to the Skills table at the top
- **Add a new section** for the skill below the "Getting started" section, following the same pattern as Email Enrichment: blockquote description, input/output, before & after visualization, how it works (3 steps), use cases (4 bullets), "Try it" prompt, link to full docs
- **Do NOT** make the repo README about one skill. It must read correctly with 1 skill or 20 skills
- **Do NOT** change the Getting Started section (it's shared across all skills)
- **Do NOT** change the GitHub repo description — it's intentionally generic for all skills

### 5. Create evals

Every skill must have `evals/evals.json` inside its directory. This is how we track quality across updates.

**Format** (follows skill-creator eval schema):
```json
{
  "skill_name": "<folder-name>",
  "evals": [
    {
      "id": 1,
      "prompt": "...",
      "expected_output": "...",
      "files": [],
      "expectations": ["verifiable assertion 1", "verifiable assertion 2"]
    }
  ]
}
```

**Rules for good evals:**
- Minimum 3 test cases per skill covering different scenarios (happy path, edge case, specific mode)
- Put contact lists / input data directly in the prompt — no xlsx input files. Keeps evals self-contained and version-controllable
- Expectations must be objectively verifiable (pass/fail, not subjective quality)
- Each expectation should test a meaningful behavior, not a trivial one
- Cover the key differentiators of the skill (batching, fallback chains, identity verification, etc.)

### 6. Create the .skill release

**This is not optional.** The README links to Releases for users to download. An empty Releases page is a broken experience.

```bash
# Package the skill (only SKILL.md goes in the .skill file)
cd /path/to/skills
zip -r <skill-name>.skill <skill-name>/SKILL.md

# Create the release
gh release create v<X.Y.Z> <skill-name>.skill \
  --title "v<X.Y.Z> — <Skill Display Name>" \
  --notes "Release notes with install instructions for Claude.ai / Desktop and Claude Code"
```

**When to bump versions:**
- New skill added → minor bump (v1.1.0, v1.2.0)
- Existing skill updated → patch bump (v1.1.1)
- Breaking changes → major bump (v2.0.0)

Include **all** current `.skill` files in each release so users can always download any skill from the latest release.

### 7. Pre-push audit

Before pushing, verify every single one of these:

- [ ] **Skill name** is consistent across: folder name, SKILL.md frontmatter `name:`, evals.json `skill_name`
- [ ] **MCP server URL** is `https://mcp.crustdata.com/mcp` everywhere (both READMEs + SKILL.md)
- [ ] **No internal techniques exposed** in READMEs (GitHub commit history, Codeforces scraping, etc. stay in SKILL.md only)
- [ ] **Release exists** with downloadable `.skill` file before the README links to it
- [ ] **All links work** — relative links to files that exist, external URLs that resolve
- [ ] **evals.json is valid JSON** — run `python3 -c "import json; json.load(open('evals/evals.json'))"`
- [ ] **Setup instructions cover all platforms** — "Claude.ai or Claude Desktop" listed first, Claude Code second. No "MCP server" in the non-technical section
- [ ] **Before/after example** is present in both the repo README section and the skill README
- [ ] **No typos** in skill names, company names, or API endpoint URLs
- [ ] **Repo README skills table** has the new skill listed
- [ ] **`.gitignore`** includes `*.skill` so build artifacts aren't committed
- [ ] **GitHub repo description** is still accurate and generic (not specific to one skill)

## File structure

```
skills/
├── CLAUDE.md              # This file — contributor guide
├── README.md              # Repo-level skills catalog
├── LICENSE                # MIT
├── .gitignore             # Excludes *.skill build artifacts
└── email-enrichment/      # One directory per skill
    ├── SKILL.md           # AI-facing skill definition (can have internal details)
    ├── README.md          # Human-facing docs (public-safe only)
    └── evals/
        └── evals.json     # Test cases for benchmarking
```

## Common mistakes to avoid

1. **Linking to releases that don't exist.** Always create the release with the `.skill` file BEFORE pushing README changes that reference it
2. **Writing the repo README as a single-skill landing page.** The repo README is a catalog. Each skill gets a section, but the intro, Getting Started, and Contributing sections are shared
3. **Exposing implementation techniques in READMEs.** The SKILL.md is private to the AI. The README is public to the world. Techniques like GitHub commit email extraction are competitive advantages — keep them in SKILL.md, describe them generically in the README ("multi-source discovery")
4. **Naming skills with internal jargon.** Use the term your customer would search for, not your internal project name
5. **Forgetting non-technical users.** Most prosumer users are on Claude.ai or Claude Desktop — they don't know what MCP means. Setup instructions for these platforms go first and must be dead simple (no JSON configs, no CLI commands, no jargon)
6. **Making the GitHub repo description skill-specific.** The description must work for all skills, current and future
