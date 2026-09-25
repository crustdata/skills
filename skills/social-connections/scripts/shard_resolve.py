#!/usr/bin/env python3
"""Build the resolution work queue for a social-connections run.

After the first merge, most rows carry a urn-only LinkedIn url (ACoAA...) and many
have no current employer, because the gather angles read them out of search results
rather than enriching each one. This shards those rows into todo_N.json files for
parallel resolver agents.

    python3 shard_resolve.py [run-dir] [--shards 4]
"""
import argparse, json, re, sys
from pathlib import Path

BAD = {"", "not listed on linkedin", "unresolved company (see title)", "unknown",
       "n/a", "none", "null", "-", "not listed"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", nargs="?", default=".")
    ap.add_argument("--shards", type=int, default=4)
    args = ap.parse_args()

    run = Path(args.run_dir).resolve()
    rows = json.loads((run / "final.json").read_text())
    out = run / "raw" / "resolve"
    out.mkdir(parents=True, exist_ok=True)

    need = []
    for r in rows:
        url = r.get("linkedin_url") or ""
        urn_only = "/in/ACoAA" in url
        emp = (r.get("employer_norm") or "").strip().lower()
        # one url person_enrich cannot parse fails its whole 25-url batch, so only the canonical form goes
        if (urn_only or emp in BAD) and re.fullmatch(r"https://www\.linkedin\.com/in/[^/?#]+", url):
            need.append(url)

    print(f"rows needing resolution: {len(need)} of {len(rows)}")
    if not need:
        return
    n = max(1, args.shards)
    for i in range(n):
        shard = need[i::n]
        (out / f"todo_{i}.json").write_text(json.dumps(shard))
        print(f"  shard {i}: {len(shard)} urls -> {(len(shard) + 24) // 25} enrich calls")


if __name__ == "__main__":
    main()
