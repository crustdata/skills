# Social Connections

Paste one LinkedIn URL and get a ranked list of the people that person knows, each with the reason they are on it. Powered by [Crustdata](https://crustdata.com)'s real-time people, company and post data.

## What it does

- **Input:** one LinkedIn profile URL, plus anything you want to focus on ("who at Stripe", "leave out weak matches")
- **Output:** a spreadsheet (`.xlsx`) with one row per person, tiered A to D by how strong the evidence is
- **Every row says why.** "Worked on the same team 2019-2021", "commented on their post about the launch". Never "seems related"
- **Sliced by where people work now.** A filterable people tab, plus a tab that counts each current employer by tier
- **Works for any career.** Engineers, recruiters, founders, sellers, academics. The profile decides where to look

You never see someone's real connection list, and neither does this. It rebuilds it from overlap (jobs, teams, schools, labs) and from who engages with the person online.

## Example

**Input:**
> "Who does linkedin.com/in/&lt;their-profile&gt; know? I mostly care about who's at Stripe now."

**Output (excerpt from the tier A tab, names made up):**

| Tier | Name | Works at now | Why they're here |
|---|---|---|---|
| A | Priya Raman | Stripe | Same payments team 2019-2021; commented on their post about the launch |
| A | Marco Silva | Stripe | Co-authored a paper with them in 2016; same lab at university |
| B | Dana Fox | Plaid | Same company and function 2020-2022 |
| C | Sam Ortiz | Stripe | Same company, overlapping years, different function |

Plus a summary tab, a by-employer tab ("Stripe: 14 people, 3 in tier A"), and a coverage tab that says which sources were searched and what was left out.

## How it works

1. **Reads the person's history.** Crustdata's people data gives their jobs, teams, schools and posts, and Claude picks the places their network most likely came from
2. **Searches each one.** Crustdata finds who overlapped with them, and who engages with their posts, and every match is kept only with a named reason
3. **Scores and ships.** People found through several independent routes rise to the top, each row is matched to where that person works today, and the spreadsheet is written

Before the big search steps, Claude tells you roughly how many credits the run will use and waits for your go-ahead.

## Setup

Install the Crustdata plugin. It carries the Crustdata connector and this skill, so there is nothing else to set up.

### Claude.ai, Claude Desktop, or Cowork

1. Open **Customize** in the left sidebar, then the **Plugins** tab
2. Click **Add**, then **Add marketplace**
3. Enter the repository `crustdata/skills`
4. Install the **Crustdata** plugin ([step-by-step guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude))
5. Ask: "Who does linkedin.com/in/dvdhsu know?"

### Claude Code (CLI)

```bash
claude plugin marketplace add crustdata/skills
claude plugin install crustdata@crustdata-plugin
```

Then run `/crustdata:social-connections https://www.linkedin.com/in/<their-profile>`.

A busy profile is a long job. Claude Code runs the searches side by side, which is the fastest way to use it. Elsewhere they run one after another.

**Just the data?** Add Crustdata as a connector instead: **Customize > Connectors > Add custom connector**, then paste `https://install.crustdata.com/mcp`. For agent frameworks and backend jobs, see the [MCP docs](https://docs.crustdata.com/for-agents/mcp).

## Crustdata tools used

All tools run inside `execute({ code })` scripts via `callTool("<tool>", params)`.

| Tool | What it does | Cost |
|------|-------------|------|
| `person_enrich` | The person's profile, and where each match works now | 1 cr/profile |
| `company_identify` | Turns each employer into an exact company id | Free |
| `person_search` | Who overlapped with them at each job and school | ~0.03 cr/result |
| `social_post_list_live` | Their posts, and who reacted and commented | 1 cr/post, +5 per 100 reactors or comments, +10 per 100 of both |
| `social_post_search` | Posts they were tagged in | 0.5 cr/post, counts free |
| `web_search_live` | Papers, patents, panels and press that name them together | 1 cr/query |

These are list rates, and your plan may differ: Claude reads the actual cost of the first call and tells you the total before the big steps. The two post tools depend on your plan. Without them the skill still runs on work and school history, and says what it skipped.

## Evals

Test cases in [`evals/evals.json`](./evals/evals.json). The merge, scoring and spreadsheet scripts have offline checks in [`evals/test_merge.py`](./evals/test_merge.py).
