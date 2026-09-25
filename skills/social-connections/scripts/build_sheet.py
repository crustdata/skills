#!/usr/bin/env python3
"""Write the social-connections workbook from final.json.

Tabs: summary | all people | by employer | tier A | tier B | tier C |
      tier D (appendix) | coverage

Every people tab carries current_company / current_title under a filter, so the
list can be sliced by current employer. "by employer" is the precomputed pivot
of the same thing. Re-running overwrites the file.

    python3 build_sheet.py --run-dir <run-dir> --dry-run
    python3 build_sheet.py --run-dir <run-dir> [--no-tier-d]

Needs openpyxl (pip install openpyxl) for everything except --dry-run.
"""
import argparse, json, re
from collections import Counter, defaultdict
from pathlib import Path

MAX_CELL = 32000  # Excel refuses cells over 32,767 UTF-16 units
# openpyxl refuses the workbook on a control character and writes an unreadable one on a lone
# surrogate or U+FFFE/U+FFFF; post text carries all of them verbatim, surrogates from a cut emoji
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")
TIER_TABS = {"A": "tier A", "B": "tier B", "C": "tier C", "D": "tier D (appendix)"}
PEOPLE_HEADER = ["tier", "score", "name", "linkedin_url", "current_company",
                 "current_title", "headline", "location", "engaged", "angles",
                 "evidence"]


def cell(v):
    if v is None or isinstance(v, (int, float)):
        return v
    return CONTROL.sub("", str(v)).encode("utf-16-le")[: 2 * MAX_CELL].decode("utf-16-le", "ignore")


def person_row(r):
    ev = "; ".join(f"[{e['strength']}] {e['text']}" for e in r.get("evidence", []))
    return [r.get("tier"), r.get("score"), r.get("name"), r.get("linkedin_url"),
            r.get("employer_norm"), r.get("current_title"), r.get("headline"),
            r.get("location"), "yes" if r.get("engaged") else "",
            ", ".join(map(str, r.get("angles", []))), ev]


def write_tab(wb, title, header, rows, filtered=True):
    from openpyxl.styles import Font, PatternFill
    ws = wb.create_sheet(title)
    # ws.cell, not ws.append + ws[ws.max_row]: max_row rescans every cell, so that loop is quadratic
    for i, row in enumerate([header, *rows], start=1):
        for j, v in enumerate(row, start=1):
            c = ws.cell(row=i, column=j, value=cell(v))
            # openpyxl stores any string starting with "=" as a formula
            if isinstance(c.value, str) and c.value.startswith("="):
                c.data_type = "s"
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="262626")
    ws.freeze_panes = "A2"
    if filtered:
        ws.auto_filter.ref = ws.dimensions


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", default=".")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-tier-d", action="store_true", help="leave tier D out of the workbook")
    args = ap.parse_args()
    run = Path(args.run_dir).resolve()

    rows = json.loads((run / "final.json").read_text())
    meta = json.loads((run / "run.json").read_text()) if (run / "run.json").exists() else {}
    target_name = meta.get("name", "target")
    n_tier_d = sum(1 for r in rows if r["tier"] == "D")
    if args.no_tier_d:
        rows = [r for r in rows if r["tier"] != "D"]
    by_tier = defaultdict(list)
    for r in rows:
        by_tier[r["tier"]].append(r)

    piv = defaultdict(Counter)
    for r in rows:
        emp = r.get("employer_norm") or "(unknown)"
        piv[emp][r["tier"]] += 1
        piv[emp]["total"] += 1
    emp_rows = sorted(piv.items(), key=lambda kv: -kv[1]["total"])
    employer_rows = [[e, c["total"], c["A"], c["B"], c["C"], c["D"]] for e, c in emp_rows]

    summary = [
        ["target", meta.get("linkedin_url", "")],
        ["headline", meta.get("headline", "")],
        ["stated connections", meta.get("connections", "")],
        ["records", len(rows)],
        ["engagement-evidenced", sum(1 for r in rows if r.get("engaged"))],
        ["distinct current employers", len([e for e in piv if e != "(unknown)"])],
        [],
        ["tier", "n", "meaning"],
        ["A", len(by_tier["A"]), "first-party engagement (commented/tagged/co-authored/reacted) or 2+ strong overlaps"],
        ["B", len(by_tier["B"]), "one strong overlap, or a reaction, or several medium overlaps"],
        ["C", len(by_tier["C"]), "same company + same function + overlapping window"],
        ["D", n_tier_d, "single weak inference" + (" (left out of this workbook)" if args.no_tier_d else "")],
        [],
        ["angle", "n"],
    ]
    angles = Counter(a for r in rows for a in r.get("angles", []))
    summary += [[a, c] for a, c in angles.most_common()]

    coverage = []
    for a, _ in angles.most_common():
        sel = [r for r in rows if a in r.get("angles", [])]
        n = Counter(e["strength"] for r in sel for e in r["evidence"] if e["angle"] == a)
        coverage.append([a, len(sel), n["strong"], n["medium"], n["weak"]])

    print(f"rows {len(rows)} | tiers " + " ".join(f"{t}={len(by_tier[t])}" for t in "ABCD"))
    print(f"employers {len(piv)} | top: " + ", ".join(f"{e}({c['total']})" for e, c in emp_rows[:8]))
    if args.dry_run:
        print("dry run, no workbook written")
        return

    try:
        from openpyxl import Workbook
    except ImportError:
        raise SystemExit("openpyxl is not installed: run `pip install openpyxl` and re-run")
    wb = Workbook()
    wb.remove(wb.active)
    write_tab(wb, "summary", [f"{target_name} - inferred LinkedIn connections"], summary, filtered=False)
    write_tab(wb, "all people", PEOPLE_HEADER, [person_row(r) for r in rows])
    write_tab(wb, "by employer", ["current_employer", "total", "tier A", "tier B", "tier C", "tier D"], employer_rows)
    for t, tab in TIER_TABS.items():
        if t == "D" and args.no_tier_d:
            continue
        write_tab(wb, tab, PEOPLE_HEADER, [person_row(r) for r in by_tier[t]])
    write_tab(wb, "coverage", ["angle", "records", "strong", "medium", "weak"], coverage)
    out = run / f"{meta.get('slug', 'target')}-connections.xlsx"
    wb.save(out)
    print(out)


if __name__ == "__main__":
    main()
