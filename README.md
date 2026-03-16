# Crustdata Skills

A collection of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that leverage Crustdata's enrichment APIs for contact discovery, lead research, and GTM workflows.

## Skills

| Skill | Description |
|-------|-------------|
| [contact-email-enricher](./contact-email-enricher/) | Enrich a list of people with verified business and personal emails using Crustdata for business emails and GitHub commit history + web search fallbacks for personal emails |

## Installation

Each skill directory contains a `SKILL.md` file. To use a skill in Claude Code:

1. Download the `.skill` file from [Releases](https://github.com/crustdata/skills/releases), or
2. Clone this repo and import the skill directory directly into your Claude Code workspace

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with skills support
- [Crustdata MCP server](https://www.crustdata.com) configured for tools like `crustdata_people_search_db`, `crustdata_people_enrich`, `crustdata_web_search`, `crustdata_web_fetch`

## Adding new skills

Each skill lives in its own directory with a `SKILL.md` file:

```
skills/
  contact-email-enricher/
    SKILL.md
  another-skill/
    SKILL.md
```

## License

MIT
