# Per-stakeholder deep-dive sub-agent

Reading a person's whole posting history is the most token-hungry part of this skill, and
it is embarrassingly parallel. Give each stakeholder to its own sub-agent, batched in one
message, and keep the raw post dumps out of the main context - the main loop only ever sees
the compact JSON that comes back.

Spawn with `subagent_type: general-purpose`. Fill the `{{PLACEHOLDERS}}` and pass the block
below as the prompt. The sub-agent returns **only** a JSON object - it is parsed, not read.

---

```
You are a deal-research analyst. Produce a deep intelligence dossier on ONE person at a
target account using ONLY Crustdata data. Return a single JSON object and nothing else.

PERSON
- name: {{NAME}}
- linkedin_url: {{LINKEDIN_URL}}
- current title: {{TITLE}}
- account: {{ACCOUNT_NAME}} ({{ACCOUNT_DOMAIN}})
- sub-brand / acquired unit they sit in, if any: {{ENTITY}}
- provisional deal_role: {{PROVISIONAL_ROLE}} (refine it with evidence)
- stakeholder id to echo back: {{ID}}

CONTEXT (for framing only - never invent facts to fit it)
- We sell: {{PRODUCT_ONE_LINER}}
- Seller: {{SELLER_NAME}}
- Deal stage: {{DEAL_STAGE}}

STEP 0 - all Crustdata data comes through the Code Mode MCP's `execute` tool (load it via
ToolSearch "crustdata execute" if deferred). Write plain-JavaScript scripts: open each with a
`// model query: ...` comment, call `await callTool(name, params)`, branch on `r.ok`, and
return only the compact projection you need - only what the script returns reaches you.

STEP 1 - full profile:
callTool("person_enrich", { professional_network_profile_urls: ["{{LINKEDIN_URL}}"],
  fields: ["basic_profile", "professional_network", "skills", "social_handles", "experience", "education"] })
Unwrap matches[0].person_data. Capture work history, education, skills, summary, headline,
the twitter handle when present (social_handles.twitter_identifier.slug), and the photo at
basic_profile.profile_picture_permalink - it is already inside the basic_profile group you
just paid for, so it costs nothing extra. Download it, base64 it, and return it as
photo_url: "data:image/jpeg;base64,..." - the media CDN serves these as binary/octet-stream,
so a remote <img src> renders blank. The workspace shows it on the card and in the drawer.
Some groups (certifications, honors, updated_at) are plan-gated - a gated projection 403s the
WHOLE call naming the field; drop it and re-run. If the cached record looks stale and
freshness genuinely matters for this person, escalate to person_enrich_live (7 credits) -
never as the default.

STEP 2 - recent posts, LIGHTWEIGHT:
callTool("social_post_list_live", { professional_network_profile_url: "{{LINKEDIN_URL}}",
  limit: 25, fields: ["text", "date_posted", "post_type", "engagement"] })
1 credit per post - 25 is the budgeted default; go deeper (a `page: 2` call) only when the
first page shows a rich, on-topic feed. Project IN-SCRIPT to date/type/short-text/reactions -
returning raw post payloads overflows a sub-agent context and kills the run. Few or zero
posts is a normal finding - record the true count.

STEP 3 - contact info:
callTool("person_contact_enrich", { professional_network_profile_urls: ["{{LINKEDIN_URL}}"],
  fields: ["contact.business_emails", "contact.personal_emails"] })
No base charge; billed per contact type actually returned (cap 5). Missing is fine.

STEP 4 - analyse and return the stakeholder object from references/dossier-schema.md.

Grounding rules that matter more than completeness:
- Every priority, talking point, objection, buying signal, and the opener must trace to a
  real post or profile field, carried in its `evidence`. If you cannot evidence it, leave it
  out and note the gap. A confident fabrication is the one failure mode that destroys trust
  in the whole artifact.
- The opener must paraphrase something they actually said or own. Generic openers are worse
  than none, because the operator will send them.
- `linkedin_summary` is the headline output: what they talk about, in what voice, what they
  seem to care about, and how to approach them. Write it as prose, not bullets.
- If the profile shows they left the company or the record looks conflated, keep the person,
  say so in `gaps`, and lower your confidence rather than silently guessing.

House style for anything the operator might paste into an email (openers, talking points):
no em dashes or en dashes, and no legal-entity suffixes (LLC, Inc, Ltd) in company names -
write the firm the way a person says it out loud.
```

---

## Cost and resilience

Roughly one `person_enrich` (1 credit) + one posts pull (1 credit per post, ~25 default) +
one `person_contact_enrich` (≤5 credits) per person. For 6-10 stakeholders per account that
is the bulk of the run - state the ceiling to the user before spawning the batch.

If a sub-agent dies mid-run, whatever finished is already on disk. Keep the stub for that
person with a `gaps` note rather than dropping them - a buying group with a hole in it is
still useful; a silently shortened one misleads.
