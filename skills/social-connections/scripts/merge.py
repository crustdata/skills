#!/usr/bin/env python3
"""Merge + score the per-angle gather files for a social-connections run.

Reads <run-dir>/raw/*.json (the per-angle output contract in references/output-contract.md),
folds in <run-dir>/raw/resolve/done_*.json, dedupes by LinkedIn identity, merges
evidence, scores, tiers, and normalises current employer so the workbook can be
sliced by it.

    python3 merge.py [run-dir]        # default: cwd
"""
import json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote, unquote

RUN = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
RAW = RUN / "raw"

STRONG, MEDIUM, WEAK = "strong", "medium", "weak"
POINTS = {STRONG: 4, MEDIUM: 2, WEAK: 1}

# the output contract starts engagement evidence with its verb; matching anywhere
# else turns employers like "Reaction Engines" or "Tagged" into engagement
ENGAGEMENT = re.compile(
    r"^\s*(commented|reacted|tagged|co-?authored|co-?authors?|co-?panelists?)\b", re.I)

SUFFIXES = (
    " inc.", " inc", " llc", " ltd.", " ltd", " corporation", " corp.", " corp", " co.",
    " limited", " gmbh", " plc", " s.a.", " ag", " pte", " pte.",
)
EMPLOYER_ALIASES = {
    "google llc": "Google", "google inc": "Google", "alphabet": "Google",
    "x, the moonshot factory": "X (Alphabet)", "google x": "X (Alphabet)",
    "meta platforms": "Meta", "facebook": "Meta",
    "amazon web services": "Amazon", "aws": "Amazon", "amazon.com": "Amazon",
}
UNKNOWN = {"", "none", "null", "n/a", "unknown", "-", "not listed on linkedin", "not listed",
           "unresolved company (see title)", "n/a (see headline)", "unemployed", "self-employed",
           "self employed", "retired"}
TEXT_FIELDS = ("name", "linkedin_url", "urn", "headline", "current_company", "current_title",
               "location", "angle", "strength", "query_url", "resolved_url")
SURROGATE = re.compile(r"[\ud800-\udfff]")
PROFILE_URL = re.compile(r"https://www\.linkedin\.com/in/[^/?#]+")


def text(v):
    """A scalar as clean text. Agents write numbers, nulls, objects and half an emoji
    into string fields; any of them would crash a later step."""
    if isinstance(v, (str, int, float)) and not isinstance(v, bool):
        return SURROGATE.sub("", str(v)).strip()
    return ""


def clean(r):
    return {**r, **{f: text(r.get(f)) for f in TEXT_FIELDS if f in r}}


def stable(rows):
    """Sorted on content, so nothing downstream depends on file names or record order."""
    return sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, default=str))


def norm_employer(v):
    """Canonical employer string, so the employer slice does not split
    'Google' / 'Google LLC' / 'Alphabet' into three buckets."""
    s = (v or "").strip()
    if s.lower() in UNKNOWN:
        return ""
    # alias lookup first, on the raw value, so "Google LLC" -> "Google" directly
    if s.lower().rstrip(" .,") in EMPLOYER_ALIASES:
        return EMPLOYER_ALIASES[s.lower().rstrip(" .,")]
    # then strip a legal suffix, keeping the original casing of what remains
    out = s.rstrip(" .,")
    low = out.lower()
    for suf in SUFFIXES:
        if low.endswith(suf):
            out = out[: len(out) - len(suf)].rstrip(" .,")
            break
    return EMPLOYER_ALIASES.get(out.lower().rstrip(" .,"), out)


def urn_of(url, urn):
    """The ACoAA member id, from a urn field or a urn-form profile url."""
    for cand in (urn or "", url or ""):
        m = re.search(r"(ACoAA[A-Za-z0-9_-]{8,})", cand)
        if m:
            return m.group(1)
    return ""


def slug_of(url):
    m = re.search(r"linkedin\.com/in/([^/?#]+)", url or "", re.I)
    slug = unicodedata.normalize("NFC", unquote(m.group(1))).strip() if m else ""
    # member and Sales Navigator ids are case-sensitive ids, not vanity slugs
    return "" if slug.lower().startswith(("acoaa", "acwaa")) else slug.lower()


def identity(url, urn, aliases):
    """Key on the vanity slug whenever any source knows it, else the urn. Post
    reactors arrive urn-only and search rows vanity-only, so keying on either
    alone splits one person into two rows."""
    u = urn_of(url, urn)
    s = slug_of(url) or aliases.get(u, "")
    if s:
        return "slug:" + s
    return "urn:" + u if u else ""


def url_of(key):
    """The canonical profile url for an identity key. person_enrich rejects a whole
    25-url call when one url carries a query string, so only this form goes out."""
    if key.startswith(("slug:", "urn:")):
        return "https://www.linkedin.com/in/" + quote(key.split(":", 1)[1], safe="-_.~")
    return ""


def load_list(path):
    """A json file as a list of dicts. Accepts the wrappers agents tend to save
    (an execute result's value, a records/results envelope, a single record)."""
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        print(f"  SKIP {path.name}: {e}", file=sys.stderr)
        return None
    while isinstance(data, dict):
        inner = next((data[k] for k in ("records", "results", "people", "rows", "data", "value")
                      if isinstance(data.get(k), (list, dict))), None)
        if inner is not None:
            data = inner
        elif "evidence" in data or "query_url" in data:
            data = [data]
        else:
            break
    if isinstance(data, list) and data and all(isinstance(x, list) for x in data):
        data = [y for x in data for y in x]
    if not isinstance(data, list):
        print(f"  SKIP {path.name}: not a list of records", file=sys.stderr)
        return None
    return [r for r in data if isinstance(r, dict)]


def load_raw():
    recs, files = [], []
    for p in sorted(RAW.glob("*.json")):
        if p.name.startswith("_"):
            continue
        rows = load_list(p)
        if rows is None:
            continue
        files.append((p.name, len(rows)))
        for r in rows:
            r = clean(r)
            r["angle"] = r.get("angle") or p.stem
            recs.append(r)
    return stable(recs), files


def load_resolution():
    rows = []
    for f in sorted((RAW / "resolve").glob("done_*.json")):
        rows += [clean(r) for r in load_list(f) or []]
    return stable([r for r in rows if r.get("query_url")])


def build_aliases(done):
    """urn -> vanity slug, from resolver rows only. A gather record pairing a urn with a
    vanity url can be a copy-paste error, and trusting it merges two people into one."""
    aliases = {}
    for r in done:
        u, s = urn_of(r["query_url"], ""), slug_of(r.get("resolved_url"))
        if u and s:
            aliases.setdefault(u, s)
    return aliases


def evidence_items(r):
    ev = r.get("evidence")
    if isinstance(ev, str):
        ev = [ev]
    if not isinstance(ev, list):
        ev = []
    out = []
    for e in ev:
        if isinstance(e, dict):
            t = text(e.get("text") or e.get("evidence") or e.get("reason"))
            strength = (text(e.get("strength")) or r.get("strength") or WEAK).lower()
        elif isinstance(e, str):
            t = text(e)
            strength = (r.get("strength") or WEAK).lower()
        else:
            continue
        if strength not in POINTS:
            strength = WEAK
        if t:
            out.append({"text": t, "strength": strength, "angle": r.get("angle", "")})
    if not out:
        # a row with no named reason scores as the weakest tie, whatever strength it claims
        out.append({"text": f"surfaced by angle {r.get('angle','')}", "strength": WEAK,
                    "angle": r.get("angle", "")})
    return out


def merge(recs, aliases):
    people = {}
    dropped = 0
    for r in recs:
        key = identity(r.get("linkedin_url"), r.get("urn"), aliases)
        if not key:
            nm = (r.get("name") or "").strip().lower()
            if not nm:
                dropped += 1
                continue
            # a name is only an identity within one angle; across angles it merges strangers
            key = f"name:{r.get('angle', '')}:{nm}"
        p = people.get(key)
        if p is None:
            p = people[key] = {
                "key": key, "name": (r.get("name") or "").strip(),
                "linkedin_url": r.get("linkedin_url") or "", "urn": r.get("urn") or "",
                "headline": r.get("headline") or "", "current_company": r.get("current_company") or "",
                "current_title": r.get("current_title") or "", "location": r.get("location") or "",
                "angles": [], "evidence": [],
            }
        for f in ("name", "headline", "current_company", "current_title", "location", "urn"):
            if not p.get(f) and r.get(f):
                p[f] = r[f]
        if r.get("angle") and r["angle"] not in p["angles"]:
            p["angles"].append(r["angle"])
        p["evidence"].extend(evidence_items(r))
    for key, p in people.items():
        # a url with no canonical form (/pub/, a lowercased urn) stays visible to the user;
        # shard_resolve only ever sends canonical ones to person_enrich
        p["linkedin_url"] = url_of(key) or p["linkedin_url"]
    return people, dropped


def score(p):
    seen, ev = set(), []
    for e in p["evidence"]:
        sig = (e["text"].strip().lower(), e["strength"])
        if sig in seen:
            continue
        seen.add(sig)
        ev.append(e)
    p["evidence"] = ev
    # one angle cannot stack past its best two items; stops a chatty angle inflating a row
    by_angle = defaultdict(list)
    for e in ev:
        by_angle[e["angle"]].append(POINTS[e["strength"]])
    pts = sum(sum(sorted(v, reverse=True)[:2]) for v in by_angle.values())
    engaged = any(ENGAGEMENT.search(e["text"]) for e in ev)
    n_strong = sum(1 for e in ev if e["strength"] == STRONG)
    p["score"] = pts
    p["engaged"] = engaged
    p["n_strong"] = n_strong
    if engaged and n_strong:
        p["tier"] = "A"
    elif pts >= 8 or n_strong >= 2:
        p["tier"] = "A"
    elif engaged or n_strong == 1 or pts >= 5:
        p["tier"] = "B"
    elif pts >= 3 or any(e["strength"] == MEDIUM for e in ev):
        p["tier"] = "C"
    else:
        p["tier"] = "D"
    p["employer_norm"] = norm_employer(p.get("current_company"))
    return p


def apply_resolution(people, done, aliases):
    """Take current employer/title from raw/resolve/done_*.json over whatever a gather
    agent parsed from a headline, and drop anyone the resolver found redacted: they
    opted out, so they stay out of the output."""
    lookup = {}
    for r in done:
        key = identity(r["query_url"], "", aliases)
        answered = r.get("redacted") or r.get("resolved_url") or r.get("current_company")
        # a retry file can sort either side of the attempt it retries; an answer beats an error
        if key not in lookup or (answered and not (lookup[key].get("redacted") or lookup[key].get("resolved_url")
                                                   or lookup[key].get("current_company"))):
            lookup[key] = r
    fixed_emp = redacted = 0
    for key in list(people):
        r = lookup.get(key)
        if not r:
            continue
        # known limit: a redacted urn has no vanity alias, so a vanity-only row for the same person from another angle survives
        if r.get("redacted"):
            del people[key]
            redacted += 1
            continue
        p = people[key]
        new = r.get("current_company", "")
        if new.lower() not in UNKNOWN:
            # a title belongs to its employer: keep the old one only when the employer did not change
            same = norm_employer(new).lower() == norm_employer(p.get("current_company")).lower()
            p["current_title"] = r.get("current_title") or (p.get("current_title", "") if same else "")
            p["current_company"] = new
            fixed_emp += 1
        for f_ in ("headline", "location", "name"):
            if not p.get(f_) and r.get(f_):
                p[f_] = r[f_]
    return fixed_emp, redacted


def main():
    recs, files = load_raw()
    print(f"loaded {len(recs)} records from {len(files)} angle files")
    for n, c in files:
        print(f"  {n}: {c}")
    done = load_resolution()
    aliases = build_aliases(done)
    people, dropped = merge(recs, aliases)
    print(f"merged to {len(people)} unique people ({dropped} dropped, no identity)")
    fe, red = apply_resolution(people, done, aliases)
    if done:
        print(f"resolution pass: {fe} current employers filled, {red} redacted rows removed")
    rows = [score(p) for p in people.values()]
    # one pivot bucket per employer regardless of casing, shown in its most common spelling
    spellings = defaultdict(Counter)
    for r in rows:
        spellings[r["employer_norm"].lower()][r["employer_norm"]] += 1
    for r in rows:
        counts = spellings[r["employer_norm"].lower()]
        r["employer_norm"] = min(counts, key=lambda s: (-counts[s], s))
    rows.sort(key=lambda r: (r["tier"], -r["score"], r["name"].lower(), r["key"]))
    (RUN / "final.json").write_text(json.dumps(rows, indent=1))

    meta = json.loads((RUN / "run.json").read_text()) if (RUN / "run.json").exists() else {}
    tiers = Counter(r["tier"] for r in rows)
    emp = Counter(r["employer_norm"] for r in rows if r["employer_norm"])
    angles = Counter(a for r in rows for a in r["angles"])
    md = [f"# {text(meta.get('name')) or 'target'} - inferred connections", "",
          f"Records: {len(rows)}. Engagement-evidenced: {sum(1 for r in rows if r['engaged'])}.", "",
          "## Counts by tier", "", "| tier | n |", "| --- | --- |"]
    md += [f"| {t} | {tiers[t]} |" for t in "ABCD"]
    md += ["", "## Counts by angle", "", "| angle | n |", "| --- | --- |"]
    md += [f"| {a} | {c} |" for a, c in angles.most_common()]
    md += ["", "## Top current employers", "", "| employer | n |", "| --- | --- |"]
    md += [f"| {e} | {c} |" for e, c in emp.most_common(40)]
    md += ["", "## Source files", ""] + [f"- {n}: {c}" for n, c in files]
    (RUN / "final.md").write_text("\n".join(md) + "\n")
    print("tiers:", dict(tiers))
    print("distinct current employers:", len(emp))
    print("still urn-only urls:", sum(1 for r in rows if "/in/ACoAA" in (r["linkedin_url"] or "")))
    print("still no employer:", sum(1 for r in rows if not r["employer_norm"]))
    print("wrote final.json, final.md")


if __name__ == "__main__":
    main()
