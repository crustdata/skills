#!/usr/bin/env python3
"""
parse_connections.py - normalise one or more LinkedIn connection exports into a single
owner-tagged connections.json.

LinkedIn gives people two shapes of export and this handles both:
  1. a bare Connections.csv (3 preamble lines, then the header row), and
  2. a full "Basic_LinkedInDataExport_*.zip" (or its unzipped folder) which contains
     Connections.csv plus Profile.csv.

The Profile.csv is a gift: it names the person whose export this is, so we can label the
owner automatically instead of asking the operator to remember which file is whose. That
matters because the whole point of this skill is showing *who on your team* can open a
door, and mislabelling an owner sends the intro request to the wrong person.

Usage:
  parse_connections.py --out connections.json \
      --input /path/Connections.csv \
      --input /path/Basic_LinkedInDataExport_2026.zip:Priya

  # ":Name" suffix is optional - it overrides auto-detection.

Output: {"owners": ["Doug", "Chris"],
         "connections": [{"owner","name","first","last","title","company","url","connected_on"}]}
"""
import argparse, csv, io, json, os, re, sys, zipfile


def _rows_from_csv_text(text):
    """LinkedIn puts a 'Notes:' preamble above the real header. Find the header, parse from there."""
    lines = text.splitlines()
    hi = next((i for i, l in enumerate(lines) if l.startswith("First Name,Last Name")), None)
    if hi is None:
        return []
    return list(csv.DictReader(lines[hi:]))


def _owner_from_profile(text):
    """Profile.csv has First Name,Last Name in row 1 - that is the export's owner."""
    try:
        rows = list(csv.DictReader(io.StringIO(text)))
    except Exception:
        return None
    if not rows:
        return None
    r = rows[0]
    nm = ((r.get("First Name") or "").strip() + " " + (r.get("Last Name") or "").strip()).strip()
    return nm or None


def _read_source(path):
    """Return (connections_csv_text, profile_csv_text_or_None) from a csv, folder, or zip."""
    if os.path.isdir(path):
        conn = os.path.join(path, "Connections.csv")
        prof = os.path.join(path, "Profile.csv")
        ctext = open(conn, encoding="utf-8", errors="replace").read() if os.path.exists(conn) else ""
        ptext = open(prof, encoding="utf-8", errors="replace").read() if os.path.exists(prof) else None
        return ctext, ptext
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            cn = next((n for n in names if n.rsplit("/", 1)[-1] == "Connections.csv"), None)
            pn = next((n for n in names if n.rsplit("/", 1)[-1] == "Profile.csv"), None)
            ctext = z.read(cn).decode("utf-8", "replace") if cn else ""
            ptext = z.read(pn).decode("utf-8", "replace") if pn else None
            return ctext, ptext
    # plain csv
    return open(path, encoding="utf-8", errors="replace").read(), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", action="append", required=True,
                    help="path to Connections.csv / export folder / export .zip, optionally 'path:OwnerName'")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    owners, out, seen = [], [], set()
    for spec in args.input:
        # only split on a ':' that is not part of a drive letter / URL-ish path
        path, explicit = spec, None
        m = re.match(r"^(.*[^:]):([^:/\\]+)$", spec)
        if m and not os.path.exists(spec):
            path, explicit = m.group(1), m.group(2).strip()
        if not os.path.exists(path):
            print(f"  ! missing input: {path}", file=sys.stderr)
            continue

        ctext, ptext = _read_source(path)
        rows = _rows_from_csv_text(ctext)
        owner = explicit or (_owner_from_profile(ptext) if ptext else None) \
            or os.path.splitext(os.path.basename(path.rstrip("/")))[0]
        # keep owner labels short - they render as chips and legend entries in the artifact
        owner = owner.split()[0] if owner and " " in owner and not explicit else owner
        if owner not in owners:
            owners.append(owner)

        kept = 0
        for r in rows:
            first = (r.get("First Name") or "").strip()
            last = (r.get("Last Name") or "").strip()
            nm = (first + " " + last).strip()
            if not nm:
                continue
            url = (r.get("URL") or "").strip()
            key = (owner, url or nm.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append({"owner": owner, "name": nm, "first": first, "last": last,
                        "title": (r.get("Position") or "").strip(),
                        "company": (r.get("Company") or "").strip(),
                        "url": url, "connected_on": (r.get("Connected On") or "").strip()})
            kept += 1
        print(f"  {owner}: {kept} connections from {os.path.basename(path.rstrip('/'))}", file=sys.stderr)

    json.dump({"owners": owners, "connections": out}, open(args.out, "w"), indent=1)
    print(f"[parse_connections] {len(out)} connections across {len(owners)} owner(s) -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
