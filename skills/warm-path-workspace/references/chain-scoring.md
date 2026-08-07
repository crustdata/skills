# Warm-path chains: scoring, and resolving the people in the middle

## The problem this solves

A naive warm-intro map draws a line from every connection straight to the decision maker.
That is a lie of omission, and operators notice immediately: it makes a software-engineering
intern look exactly as valuable as a GTM director. In reality the intern is four management
layers plus a function boundary away from a CHRO, while the director can catch that exec in
a staff meeting. If the map does not encode that, the operator burns their scarcest resource
- a teammate's willingness to make an ask - on the worst routes.

So every chain gets scored, ranked, colour-weighted, and given a real named intermediary.

## The score

`build_workspace.py` computes this; you do not need to do it by hand. Understanding it
matters when the ranking looks wrong and you need to explain or tune it.

**Seniority rank** from the connection's title, 1 to 5:

| Rank | Signals in title |
|---|---|
| 5 | founder, chief/CxO, EVP, president |
| 4 | VP, SVP, head of, global head |
| 3 | director, principal, staff, distinguished |
| 2 | manager, senior, lead, architect |
| 1 | everything else (IC, intern, analyst, coordinator) |

**Function** from the title: People, Exec, GTM, Product, Data, Engineering, Other. Checked
in that order, so "VP People Engineering" reads as People rather than Engineering.

**Cross-function penalty** - extra hops to get from their org into the buyer's org:
People 0, Exec 0, GTM 1, Product 1, Data 2, Engineering 2, Other 2.

**Hops** = `(5 - rank) + penalty`, clamped to 1-5. Someone inside a small acquired unit that
the decision maker also belongs to gets a shortened path, because small orgs are flat.

**Strength** = `100 - (hops - 1) x 20`, then `+15` if same unit, `+8` if they already sit in
the People org. Tiers: strong >= 75, medium >= 45, weak below.

The artifact sorts connections strongest-first and scales edge colour and thickness with the
score, so the eye lands on the best routes without reading a number.

## Three kinds of route, best first

The builder detects the first two automatically; only the third needs you to go look something up.

### 1. Zero hop - the connection IS a decision maker

Someone on the bench turns out to be in the buying group. Nothing beats it: no referral, no
intermediary, the door is already open. It is easy to miss because the bench and the buying
group are assembled by different phases and never compared. The builder matches on LinkedIn URL
first, then name, and emits a 0-hop chain at strength 100.

### 2. Date-verified shared history - a real former colleague

The connection and a stakeholder worked at the same company at overlapping times. This is the
strongest *evidenced* bridge available and it retargets the chain to that specific stakeholder
rather than the account's default front door.

The date check is not optional and it is the whole reason this works. Shared-employer ties look
compelling and are usually false: in testing, of 13 apparent "we both worked at X" bridges,
**only 3 survived** - the other 10 had a connection who joined after the target had already
left. Same employer, zero overlap, zero relationship. Shipping those would be worse than
shipping nothing, because a named "colleague" who never met the person is more misleading than
an honestly generic org layer.

Enable it by enriching bench members' work history into `careers.json`, keyed by LinkedIn URL or
lowercase name:

```json
{"https://www.linkedin.com/in/someone": [{"company": "Red Hat", "start": "2021-03", "end": "2023-08"}]}
```

The builder does the arithmetic, writes the overlap window into the chain note verbatim
("former colleagues at Red Hat, 2021-03 to 2023-06"), and records non-overlapping pairs as
documented dead ends in the account's `gaps` so nobody rediscovers and re-pitches them.

### 3. Org-layer bridge - everyone else

No direct tie, so the referral has to cross an org layer. That layer gets a real named leader
(below).

## Resolving the named intermediaries

The honest constraint: **LinkedIn and Crustdata do not expose reporting lines.** Nobody can
tell you that Olivia's manager is Sam and Sam's skip is Priya. Inventing those names would be
fabrication, and it is the fastest way to get an operator to send an embarrassing email.

What you *can* do is name a real person who genuinely sits in the org layer the referral must
cross, and say exactly why they qualify. That is what the INTERNAL PATH column shows.

The efficient move: intermediaries resolve **per (account, function)**, not per connection.
Every engineering connection at one account crosses the same engineering leadership. So a
handful of searches covers every chain.

For each account, for each function present in that account's bench:

```
person_search with:
  experience.employment_details.current.company_id = <account company_id>
  experience.employment_details.current.seniority_level in ["CXO", "Vice President", "Director"]
  + a title/function filter matching that function
  limit 5; rank by seniority in-script
```

Pick the most senior credible result and record it:

```jsonc
{
  "Acme": {
    "Engineering": [{"name": "...", "title": "VP, Platform Engineering",
                     "linkedin_url": "...",
                     "basis": "most senior Engineering leader at Acme (person_search, seniority=VP)"}],
    "GTM": [{...}]
  }
}
```

Write that to `intermediaries.json` and pass it with `--intermediaries`. The builder attaches
the first entry per function to that function's bridge node, so the chain renders as
`connection -> named leader (their real title) -> decision maker`.

**Always populate `basis`.** It renders under the chain and it is the difference between "we
believe this person is in the path, here is why" and an unfalsifiable claim. Good basis
strings say how the person was found and what makes them relevant. Never write a basis that
asserts a reporting relationship you did not observe.

If a function returns nothing credible, leave it out - the bridge falls back to the generic
org-layer label ("Engineering org"), which is honest about what is and is not known.

## Reading the finished map

- **Strong / short (green, thick)**: founders, unit heads, People-org people, anyone inside a
  small acquired unit the buyer also sits in. Spend your asks here.
- **Medium (amber)**: directors and heads in adjacent functions - real access, one org hop.
- **Weak / many hops (grey, thin)**: junior ICs in distant functions. Not worthless, but a
  poor use of a teammate's social capital unless nothing better exists.

An account with zero strong chains is itself a finding: say so, and treat the account as
cold-outbound rather than warm-intro until the team's network grows into it.
