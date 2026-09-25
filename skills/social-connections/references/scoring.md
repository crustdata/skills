# strength, score, tiers

## strength, assigned by the gather agent

- **strong**, first-party engagement (commented on their post, they commented on
  yours, tagged, reacted 2+ times), direct co-author or co-inventor, named
  co-panelist, or same small team + same function + overlapping window.
- **medium**, same company + same function + overlapping window at a larger org;
  same lab, cohort, or advisor; a single reaction.
- **weak**, same company + overlapping window, different function. Same school,
  same years, nothing else.

## score, computed by merge.py

Points: strong 4, medium 2, weak 1.

Two guards, both learned from real runs:

1. **identical evidence is deduped** before scoring (same text + same strength),
   so two angles reporting the same fact do not double-count it.
2. **each angle contributes only its best two items.** Without this, an angle that
   writes six evidence lines per person outranks an angle that writes one good one.

## tiers

    A   first-party engagement AND at least one strong item
        OR score >= 8
        OR 2+ strong items
    B   any engagement, OR exactly one strong item, OR score >= 5
    C   score >= 3, OR any medium item
    D   everything else

## sanity check after merging

Look at the top of tier A. It should be people surfaced by **3-4
independent angles**, the co-author who was also a colleague, the ex-report who
also reacted to the post. If tier A is mostly single-angle rows, one agent is
over-claiming `strong` and its rubric needs tightening before you ship.

Cross-angle agreement also catches fabricated profiles. A profile that copies the
target's career history under another name gets flagged by several angles at once
for holding the target's unique job titles; drop it rather than rank it.
