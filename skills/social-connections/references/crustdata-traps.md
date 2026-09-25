# crustdata traps (paste into BRIEF.md verbatim)

Each of these costs rows or credits, and most of them fail silently.

## 1. identity: key on ids and urls, never on names

Names collide. A `comments.name = "<target>"` filter returns posts where a
*different* person with the same name commented. Match people by LinkedIn url or
by `crustdata_person_id`, never by name.

## 2. crustdata_entity_id is shared by people and companies

In `social_post_search`, `actor.crustdata_entity_id`, `comments.crustdata_entity_id`
and `reactors.crustdata_entity_id` hold a person's `crustdata_person_id`, but a
company page can carry the same number. Always pair the id with the actor type,
inside one `and_()` so both bind to the same comment or reactor:

    and_(eq("comments.crustdata_entity_id", id), eq("comments.actor_type", "person"))

Without the type, a target's "own posts" can include an unrelated company's page.

## 3. urls must match the stored form exactly

`actor.professional_network_url = "https://www.linkedin.com/in/<slug>"` matches;
the same url with a trailing slash matches nothing. Strip trailing slashes and
query strings (`?miniProfileUrn=...`) from every url before you filter on it or
write it to a record.

## 4. post engagement arrives in two url forms

`social_post_list_live` returns reactors as urn urls (`/in/ACoAA...`) and
commenters as vanity urls. `social_post_search` returns both a vanity
`professional_network_url` and a urn-form `professional_network_urn`. Put the
vanity url in `linkedin_url` and anything containing `ACoAA` in `urn`, so the
merge can join them.

## 5. filter past employers by company_id

    eq("experience.employment_details.past.company_id", <id>)

The filter column is `company_id`; the response field is `crustdata_company_id`.
Company names are fuzzy: "Delta" and "Mercury" each match dozens of unrelated
companies. Resolve every employer once with `company_identify` (free)
and hand the id to every agent. Verify an id returns the people you expect before
an agent spends on it.

## 6. positions with company_id 0 are invisible to id filters

Some employment rows carry `crustdata_company_id: 0` and no company name. When a
person you expect is missing from an id search, look them up by url directly
instead of concluding they are not there.

## 7. one employment entry vs any entry

`and_(a, b)` over employment fields requires ONE entry to satisfy both (same job,
same window). `all_of(a, b)` lets them land on different entries. For "worked at X
during the target's window", use `and_` on the same array path. Current employees
have `end_date: null`, so compute window overlap in the script rather than
filtering on `end_date`.

## 8. categorical columns need their exact stored value

Title, seniority and function columns are closed sets. A guessed value returns zero
rows with no error. Resolve each value with `person_autocomplete` (free) first.
Use `years_of_experience_raw`, not `years_of_experience`, for ranges.

## 9. fields is a whitelist, and it can be the bill

The response carries only the groups you list, so list every group you read. On
some plans each returned group is priced per result, so a wide `fields` list can
multiply the cost of a search. Project the narrowest leaf paths you need
(`get_schema` with `group` lists them), run the first page, read `credits_used`,
and quote the projected total before paging further.

Sizing a pool: `person_search` rejects `limit: 0` with a 400. Use `limit: 1`
with `fields: ["crustdata_person_id"]`, which returns `total_count` and bills one
result row at your plan's per-row price, so a count is not free. `social_post_search`
accepts `limit: 0` and counts for free.

## 10. join enrich results on matched_on, never on position

`person_enrich` echoes each input as `matched_on`, exactly as sent (a urn url stays
a urn url). The vanity url is `social_handles.professional_network_identifier.profile_url`.
Unmatched inputs come back `not_found`, so count what came back against what you
sent. Up to 25 urls per sync call. One malformed url (a query
string, a bare `ACoAA` id without the `/in/` url) fails all 25 with a 400.

## 11. redacted means opted out

A `match_status` of `"redacted"` is a person who opted out. Emit
`{"query_url": ..., "redacted": true}` for them; the merge removes them from the
output. Do not look them up another way.

## 12. post engagement is priced separately

`social_post_list_live` lists at 1 credit per post, plus 5 per 100 reactors or
comments, or 10 per 100 reactors and comments. Classify posts first without
`reactors`/`comments` in `fields`, then pull engagement only for the target's own
posts.

`social_post_search` (0.5 credits per post, `limit: 0` counts for free) keeps
reactor and commenter lists for only a small share of posts: a post can show a
reaction count with an empty `reactors` list. Take the lists for the target's own
posts from the live tool. In the index, `mentions.person_id` (posts that tag the
target) is dependable; the commented-on and reacted-to lookups usually return
little. Both post tools depend on the plan: a 403 means that tool is not enabled,
so skip it and say so in coverage.

## 13. graduation year is an age proxy

`education.schools.end_year` comes back in results. Do not use it to guess
seniority or to narrow a cohort in the script; that is filtering on age. Use
`years_of_experience_raw`.
