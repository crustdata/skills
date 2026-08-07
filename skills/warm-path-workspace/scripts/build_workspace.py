#!/usr/bin/env python3
"""
build_workspace.py - turn per-account dossiers + a team's LinkedIn connections into one
self-contained, switchable Deal Workspace artifact.

This script owns the deterministic half of the skill: matching connections to accounts,
scoring every referral chain, wiring in the named intermediaries the model resolved, and
injecting everything into the bundled template. The model never has to hand-compute a
strength score or hand-write HTML.

Why chains get scored at all: a warm connection is not a warm connection. A co-founder or
a GTM director can walk down the hall to an exec; a software-engineering intern is four
management layers and a function boundary away from the CHRO. If both render as one hop,
the operator wastes their best asks on the weakest routes. Scoring makes the ranking
honest, and the artifact then sorts and colour-weights by it.

Inputs
  --dossier NAME=path/to/dossier.json   (repeatable, one per account)
  --connections connections.json        (from parse_connections.py)
  --aliases aliases.json                (account -> [name variants incl. acquisitions])
  --intermediaries intermediaries.json  (optional; account -> function -> [{name,title,linkedin_url,basis}])
  --template assets/workspace-template.html
  --out workspace.html
  --title "..."                         (optional page title)

Output: a single HTML file, plus a printed summary of chains per account.
"""
import argparse, json, os, re, sys

# Palette for owner colours in the graph legend (stable order, colour-blind friendly-ish).
OWNER_PALETTE = ["#c07d18", "#2563c9", "#0f8a4f", "#b5379a", "#0f7d8a", "#8a5cf0"]
# Per-account accent colours, cycled.
ACCOUNT_PALETTE = ["#5b5bd6", "#76B900", "#4589FF", "#00B2E3", "#17B890", "#e0761a", "#d1443b"]

GENERIC_TOKENS = {"the", "co", "inc", "group", "edge", "labs", "technologies", "solutions"}


# ---------------------------------------------------------------- normalisation
def norm_co(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\s\.:]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def toks(s):
    return set(norm_co(s).split()) - GENERIC_TOKENS


def alias_hit(company, alias):
    """Does a connection's free-text company match this account alias?
    Multi-word aliases must appear as a phrase; single words must match a whole token,
    otherwise 'Edge' matches 'Edge Impulse' and the bench fills with false positives."""
    cc, al = norm_co(company), norm_co(alias)
    if not cc or not al:
        return False
    if " " in al or "." in al or ":" in al:
        return al.replace(":", " ").replace(".", " ").strip() in cc.replace(":", " ").replace(".", " ")
    return al in (set(cc.split()) - GENERIC_TOKENS)


# ---------------------------------------------------------------- chain scoring
def seniority_rank(title):
    """1 = IC/intern ... 5 = founder/C-level. Drives how far the person sits from an exec."""
    t = (title or "").lower()
    if re.search(r"\b(chief|chro|cpo|cto|cfo|ceo|coo|evp|president)\b", t) or "founder" in t:
        return 5
    if re.search(r"\b(svp|vp|vice president)\b", t) or "head of" in t or "global head" in t:
        return 4
    if re.search(r"\b(director|principal|distinguished|staff)\b", t):
        return 3
    if re.search(r"\b(manager|senior|sr|lead|architect)\b", t):
        return 2
    return 1


def func_of(title):
    """Which org the connection sits in. Order matters: People/Exec are checked first
    because a 'VP People Engineering' should read as People, not Engineering."""
    t = (title or "").lower()
    if re.search(r"recruit|talent|sourc|people|human resource|\bhr\b|hrbp", t):
        return "People"
    if re.search(r"founder|chief executive|\bceo\b|general manager|\bgm\b", t):
        return "Exec"
    if re.search(r"sales|gtm|account|partner|alliance|business development|revenue|marketing|customer success", t):
        return "GTM"
    if re.search(r"product|design|\bux\b", t):
        return "Product"
    if re.search(r"data|analyst|analytics|scientist", t):
        return "Data"
    if re.search(r"engineer|developer|architect|software|hardware|silicon|vlsi|\bml\b|\bai\b|research", t):
        return "Engineering"
    return "Other"


# Extra hops incurred crossing from the connection's org into the buyer's org.
FUNC_PENALTY = {"People": 0, "Exec": 0, "GTM": 1, "Product": 1, "Data": 2, "Engineering": 2, "Other": 2}
BRIDGE_LABEL = {"People": "People / TA org", "Exec": "Exec office", "GTM": "GTM & Alliances",
                "Product": "Product org", "Data": "Data / Analytics", "Engineering": "Engineering org",
                "Other": "Cross-functional"}


def tier(score):
    return "strong" if score >= 75 else ("medium" if score >= 45 else "weak")


# ---------------------------------------------------------------- shared history
def _months(d):
    """'2021-03-01' / '2021-03' / '2021' -> month ordinal. None means open-ended."""
    if not d:
        return None
    m = re.match(r"(\d{4})(?:-(\d{1,2}))?", str(d))
    if not m:
        return None
    return int(m.group(1)) * 12 + int(m.group(2) or 1)


def overlap_months(a_start, a_end, b_start, b_end):
    """Months two tenures overlapped. 0 means they were never there together.

    This is the single most important calculation in the skill. Shared-employer ties look
    compelling and are usually false: in testing, only 3 of 13 apparent 'we both worked at X'
    bridges survived this check - the other 10 joined after the target had already left. A
    named colleague who never met the person is more misleading than an honest org layer."""
    INF = 10 ** 7
    a0, a1 = _months(a_start) or 0, _months(a_end) or INF
    b0, b1 = _months(b_start) or 0, _months(b_end) or INF
    lo, hi = max(a0, b0), min(a1, b1)
    return max(0, hi - lo)


def _fmt_window(a_start, a_end, b_start, b_end):
    lo = max(_months(a_start) or 0, _months(b_start) or 0)
    hi = min(_months(a_end) or 10 ** 7, _months(b_end) or 10 ** 7)
    def s(m):
        return "present" if m >= 10 ** 6 else f"{m // 12}-{m % 12 or 12:02d}"
    return f"{s(lo)} to {s(hi)}"


def find_shared_history(conn_careers, stakeholders):
    """Return (best_tie, dead_ends). A tie is a date-verified shared employer."""
    ties, dead = [], []
    for s in stakeholders:
        for sc in (s.get("career") or []):
            sco = norm_co(sc.get("company"))
            if not sco:
                continue
            for cc in conn_careers:
                cco = norm_co(cc.get("company"))
                if not cco or not (sco == cco or sco in cco or cco in sco):
                    continue
                ov = overlap_months(cc.get("start"), cc.get("end"), sc.get("start"), sc.get("end"))
                rec = {"stakeholder": s, "company": sc.get("company"),
                       "window": _fmt_window(cc.get("start"), cc.get("end"), sc.get("start"), sc.get("end")),
                       "months": ov}
                (ties if ov > 0 else dead).append(rec)
    ties.sort(key=lambda t: -t["months"])
    return (ties[0] if ties else None), dead


def score_chain(rank, func, same_unit):
    """Return (hops, strength 8-100). Hops is the estimated number of internal steps from
    the connection to the decision maker; strength is the inverse, nudged by proximity."""
    fp = FUNC_PENALTY.get(func, 2)
    if same_unit:
        # inside a small acquired unit everyone is closer to their own leadership
        hops = max(1, (5 - rank) + (0 if func in ("People", "Exec") else 1))
    else:
        hops = max(1, min(5, (5 - rank) + fp))
    strength = 100 - (hops - 1) * 20
    if same_unit:
        strength += 15
    if func == "People":
        strength += 8          # already inside the buyer's own org
    return hops, max(8, min(100, strength))


# ---------------------------------------------------------------- main build
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dossier", action="append", required=True, help="NAME=path/to/dossier.json")
    ap.add_argument("--connections")
    ap.add_argument("--aliases")
    ap.add_argument("--intermediaries")
    ap.add_argument("--careers", help="optional JSON: connection url or lowercase name -> [{company,start,end}] for date-verified shared-history bridges")
    ap.add_argument("--template", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="Deal Workspaces")
    args = ap.parse_args()

    conns_all = []
    owners = []
    if args.connections and os.path.exists(args.connections):
        blob = json.load(open(args.connections))
        conns_all = blob.get("connections", [])
        owners = blob.get("owners", [])
    aliases = json.load(open(args.aliases)) if args.aliases and os.path.exists(args.aliases) else {}
    inters = json.load(open(args.intermediaries)) if args.intermediaries and os.path.exists(args.intermediaries) else {}
    careers_raw = json.load(open(args.careers)) if args.careers and os.path.exists(args.careers) else {}
    careers_map = {str(k).strip().lower().rstrip("/"): v for k, v in careers_raw.items()}
    owner_colors = {o: OWNER_PALETTE[i % len(OWNER_PALETTE)] for i, o in enumerate(owners)}

    companies, order, accents = {}, [], {}
    for i, spec in enumerate(args.dossier):
        if "=" not in spec:
            print(f"  ! --dossier needs NAME=path, got {spec}", file=sys.stderr)
            continue
        name, path = spec.split("=", 1)
        if not os.path.exists(path):
            print(f"  ! missing dossier {name}: {path}", file=sys.stderr)
            continue
        d = json.load(open(path))
        d.setdefault("account", {}).setdefault("name", name)
        S = d.get("stakeholders") or []
        for j, s in enumerate(S):
            s.setdefault("id", f"s{j+1}")

        def infl(s):
            try:
                return int(s.get("influence") or 2)
            except (TypeError, ValueError):
                return 2

        # Which stakeholders are reachable "front doors" when a connection sits in the parent org.
        econ = [s for s in S if s.get("deal_role") == "Economic Buyer"]
        champ = [s for s in S if s.get("deal_role") == "Champion"]
        pool = econ or champ or S
        default_target = sorted(pool, key=infl, reverse=True)[0] if pool else None

        acct_aliases = aliases.get(name) or [name]
        bench = [c for c in conns_all if any(alias_hit(c.get("company", ""), a) for a in acct_aliases)]

        # index stakeholders for zero-hop detection
        stk_by_url = {(s.get("linkedin_url") or "").strip().lower().rstrip("/"): s
                      for s in S if s.get("linkedin_url")}
        stk_by_name = {(s.get("name") or "").strip().lower(): s for s in S if s.get("name")}

        connectors, bridges, dead_ends = [], {}, []
        for k, c in enumerate(bench):
            rank = seniority_rank(c.get("title"))
            fn = func_of(c.get("title"))
            cname = (c.get("name") or "").strip().lower()
            curl = (c.get("url") or "").strip().lower().rstrip("/")

            # (1) Zero hop: the connection IS a member of the buying group. Nothing beats this,
            # and it is easy to miss because the bench and the buying group are built separately.
            zero = stk_by_url.get(curl) or stk_by_name.get(cname)
            # (2) Date-verified shared history with a stakeholder: a real former colleague.
            tie, dead = (None, [])
            if not zero:
                careers = careers_map.get(curl) or careers_map.get(cname) or []
                if careers:
                    tie, dead = find_shared_history(careers, S)
                    for de in dead:
                        dead_ends.append(f'{c.get("name")} and {de["stakeholder"].get("name")} both list '
                                         f'{de["company"]} but their tenures never overlapped, so this is not a route')

            bid, note = None, None
            same_unit_stk = [s for s in S if s.get("entity") and s.get("entity") != name
                             and alias_hit(c.get("company", ""), s.get("entity"))]
            if zero:
                target, hops, strength = zero, 0, 100
                note = "already a first-degree connection and a member of the buying group, no referral needed"
            elif tie:
                target, hops, strength = tie["stakeholder"], 1, 95
                note = f'former colleagues at {tie["company"]}, {tie["window"]}'
            else:
                target = sorted(same_unit_stk, key=infl, reverse=True)[0] if same_unit_stk else default_target
                if not target:
                    continue
                hops, strength = score_chain(rank, fn, bool(same_unit_stk))
                # Exec-level connections go straight in; everyone else routes through an org layer.
                if not (fn == "Exec" or (same_unit_stk and rank >= 4)):
                    label = BRIDGE_LABEL.get(fn, "Cross-functional")
                    bid = "b_" + re.sub(r"\W+", "", label.lower())
                    if bid not in bridges:
                        node = {"id": bid, "label": label, "func": fn}
                        cand = ((inters.get(name) or {}).get(fn) or [])
                        if cand:
                            node["name"] = cand[0].get("name")
                            node["title"] = cand[0].get("title")
                            node["basis"] = cand[0].get("basis")
                            node["linkedin_url"] = cand[0].get("linkedin_url")
                        bridges[bid] = node
            connectors.append({"id": f"c{k+1}", "name": c.get("name"), "title": c.get("title"),
                               "owner": c.get("owner"), "url": c.get("url"), "company": c.get("company"),
                               "func": fn, "rank": rank, "hops": hops, "strength": strength,
                               "bridge": bid, "target": target["id"], "note": note})

        d["graph"] = {"connectors": connectors, "bridges": list(bridges.values()),
                      "owner_colors": owner_colors,
                      "targets": [{"id": s["id"], "name": s.get("name", ""),
                                   "deal_role": s.get("deal_role", "Unknown"), "influence": infl(s)} for s in S]}

        if dead_ends:
            d.setdefault("gaps", []).extend(dead_ends[:12])
        bl = {b["id"]: (b.get("name") or b.get("label")) for b in bridges.values()}
        d["warm_paths"] = [{"path": (c["name"] + " (" + (c["title"] or "") + ")").strip(),
                            "basis": (f'{c["owner"]} 1st-degree connection: {c["note"]}' if c.get("note") else
                                      f'{c["owner"]} 1st-degree connection at {c["company"]}, '
                                      f'~{c["hops"]} hops via {bl.get(c["bridge"], "direct")} to the decision maker'),
                            "connector": c["owner"], "strength": tier(c["strength"]), "url": c["url"]}
                           for c in sorted(connectors, key=lambda x: -x["strength"])]
        for s in S:
            s["warm_paths"] = [{"via": c["name"], "connector": c["owner"], "strength": tier(c["strength"])}
                               for c in connectors if c["target"] == s["id"]]

        companies[name] = d
        order.append(name)
        accents[name] = ACCOUNT_PALETTE[i % len(ACCOUNT_PALETTE)]
        strong = sum(1 for c in connectors if c["strength"] >= 75)
        named = sum(1 for b in bridges.values() if b.get("name"))
        zh = sum(1 for c in connectors if c["hops"] == 0)
        sh = sum(1 for c in connectors if c["hops"] == 1 and c.get("note") and "colleague" in c["note"])
        print(f"  {name}: {len(S)} stakeholders, {len(connectors)} warm ({strong} strong, "
              f"{zh} zero-hop, {sh} verified ex-colleague), {len(bridges)} org layers ({named} named), "
              f"{len(dead_ends)} dead ends recorded", file=sys.stderr)

    if not companies:
        print("No dossiers loaded - nothing to build.", file=sys.stderr)
        sys.exit(1)

    data = {"companies": companies, "order": order, "accents": accents, "owners": owners}
    payload = json.dumps(data, ensure_ascii=True).replace("</", "<\\/")
    html = open(args.template).read().replace("__DATA__", payload).replace("__TITLE__", args.title)
    open(args.out, "w").write(html)
    print(f"[build_workspace] {len(companies)} account(s) -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
