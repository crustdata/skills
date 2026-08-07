# Org Chart Playbook (account-research mode 2)

Produce an org chart that looks like a real org chart: **CEO at the top, connector lines down to their leaders, each leader's people nested underneath.** Photo + name + clean title on every card. Output is a **standalone HTML file** opened in the browser (never an inline widget - it can't load photos and can't lay out a wide tree).

The whole job is: get the RIGHT people, the RIGHT structure, and RENDER it cleanly. Do all three or it's worthless.

Read `config/gtm-config.md` for what the rep sells (helps pick the relevant department). If missing, proceed with defaults.

## Step 1 - Identify + calibrate

- `company_identify` (free) → company_id, `employee_count_range`, and `basic_info.logo_permalink` (the company logo — free, use it in the chart's top bar). One identifier type per call (`domains` OR `names`), and it's fuzzy — one identifier can match several companies, so pick the top `confidence_score` match. Size drives the flow.
- **Web-search the company** (`web_search_live`) to learn how it's actually run: flat or hierarchical? title-inflated ("everyone's a VP") or flattened ("everyone's a Member of Technical Staff")? A "VP" at a 40-person startup ≠ a "VP" at a bank. This calibrates what titles mean here.

## Step 2 - Scope + depth

- **Small (≤ ~50):** map the whole company. No questions.
- **Big (> ~50):** do NOT dump everyone. Show the departments, ask which one they want (default to the one they sell into), or offer the **top exec layer** across the company. Also ask depth: exec-only / through managers / deep.

## Step 3 - Get the REAL structure (this is where charts live or die)

1. **Anchor the top from authoritative sources, NEVER by connection count.** Sorting people by LinkedIn connections is garbage - a viral BDR outranks the CFO. Instead:
   - **The Org** (`theorg.com/org/<company>`) - fetch it with `web_enrich_live`. It publishes *actual reporting relationships* and org sizes ("354 in org"). This is the reporting skeleton.
   - Annual report / leadership page / "deep dive" articles - name the true exec team.
2. **Pull the people from Crustdata** (`person_search`): the senior layer, filtered on `experience.employment_details.current.company_id`. Seniority levels are a closed set — resolve the exact labels with `person_autocomplete` on `experience.employment_details.current.seniority_level` first (expect values like `CXO`, `Vice President`, `Director`). Project `fields: ["basic_profile", "experience", "social_handles"]` — `fields` is a whitelist, and these three groups carry everything a card needs: photo (`basic_profile.profile_picture_permalink`), LinkedIn (`profileUrl(p)`, i.e. `social_handles.professional_network_identifier.profile_url`), and the title at THIS company (`experience.employment_details.current[].title`). Do NOT project `professional_network.followers` — it is plan-gated and 403s the whole call. Big pulls: paginate and project in-script, returning slim rows only.

   ```js
   // model query: senior layer at company 12345 for the org chart
   const seniorities = ["CXO", "Vice President", "Director"]; // verified via person_autocomplete
   const r = await callTool("person_search", {
     filters: { op: "and", conditions: [
       eq("experience.employment_details.current.company_id", 12345),
       in_("experience.employment_details.current.seniority_level", seniorities),
       gte("professional_network.connections", 100),
     ]},
     fields: ["basic_profile", "experience", "social_handles"],
     limit: 100,
   });
   if (!r.ok) return { error: r.message };
   return r.data.profiles.map(p => ({
     name: p.basic_profile?.name,
     title: p.experience?.employment_details?.current?.[0]?.title ?? p.basic_profile?.current_title,
     seniority: p.experience?.employment_details?.current?.[0]?.seniority_level,
     photo: p.basic_profile?.profile_picture_permalink,
     linkedin: profileUrl(p),
   }));
   ```

3. **Merge:** The Org gives the structure + real names; Crustdata gives photos (`basic_profile.profile_picture_permalink` — base64-inline it, see Step 5), LinkedIn (`profileUrl(p)`), titles. Match people by normalized name.

## Step 4 - Curate the people who matter (do NOT dump everyone)

For a 10k-person company the honest answer to "who matters" is the **~50-80 leaders you can verify and name** - not every profile the API returns. To build the tree:

- **Read every title yourself - never keyword regex.** Regex mis-files everything ("Group Chief Banking Officer" is not a regional CEO; "Head of Lending" is a business line, not Risk). Dump all names+titles, read them, hand-place each person.
- **Nest by title-scope containment:** breadth of scope = seniority. Group/Global > region > country > sub-team. "Group Head of Risk - Credit" sits under the CRO; "Head of Retail Credit Risk" sits under *him*; "GM Germany" sits under "Head of Country Branches". This is what makes it a tree, not a flat department list.
- **Clean every title by hand.** Raw LinkedIn strings are junk ("CISO - Gerente Senior de Seguridad de la Información" → "CISO"). Short, human, consistent.
- **Only use the title at the target company_id.** People carry side-company / advisory / board titles - ignore those, never stamp a "Co-Founder" from a different company onto this role.
- **Drop the unverifiable and the noise:** **profiles with < 100 LinkedIn connections** (fake/inactive/mis-tagged — pre-filter at query time with `gte("professional_network.connections", 100)`), placeholder headlines ("--", ".", one-word junk), obvious geographic/role mismatches, investors/advisors, and vague-title profiles you can't confidently place ("Director", bare "Partner"). A smaller, correct, readable chart beats a big messy one - every time.

## Step 5 - Render as a standalone HTML file

Classic top-down org tree in one self-contained HTML file (write it out, then open or preview it per Step 6):
- **CEO card at top** → thin connector line down → horizontal rail → **department-lead cards in a row** → a vertical spine under each → **that leader's people stacked and connected beneath them.**
- Each card: circular **photo**, **name**, one clean **title**, links to LinkedIn. Company logo + title in a top bar, with the Crustdata brand lockup on the bar's right edge — a small uppercase "Powered by" eyebrow plus the official Crustdata wordmark from this skill's `assets/` (base64-inline the theme-appropriate variant, ~17px tall; light chart → `crustdata-logo-light.png`, dark chart → `crustdata-logo-dark.png`), linking to crustdata.com. Same base64 rule as the photos: never reference it by URL.
- **EMBED every image as a base64 data-URI — the company logo in the top bar as well as the photos** (download the `profile_picture_permalink`, base64 it, inline it). Do NOT use remote `<img src>` URLs: the photo CDN serves images as `binary/octet-stream`, which browsers refuse to render as images, so remote refs show blank even though the file "worked" in a headless screenshot (which had them cached). Base64 = always renders + truly self-contained. Keep an `onerror` → initials fallback for the few profiles with no photo.
- Loads **fit-to-width** so the whole structure is visible at once; +/- and Fit buttons; clean thin gray connectors; white cards; one accent color for the root. No rainbow columns, no headcount badges, no clutter.
- **Let the layout adapt so nothing is hidden.** Long titles wrap rather than truncate, cards grow to fit the name they carry, and a wide tree scrolls inside its own container rather than clipping. If you have to leave people out, say so on the page ("showing the 62 leaders we could verify") instead of silently trimming the tree.

Generate it with a small Python script that holds the curated hierarchy as data and emits the HTML (keeps the structure editable and re-runnable, and keeps the layout/CSS consistent across runs). In environments with no shell or Python, emit the HTML directly instead.

## Step 6 - SELF-REVIEW before showing (mandatory)

Never show a chart you haven't looked at. Review it with whatever the environment gives you:

- **Claude Code with a local shell**: headless-Chrome screenshot. The preview server is sandbox-blocked; use the Chrome binary for the platform (macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Linux: `google-chrome` or `chromium`):
  ```
  <chrome-binary> --headless --disable-gpu \
    --screenshot=shot.png --window-size=1680,1050 --hide-scrollbars "file:///…/chart.html"
  ```
  Read the screenshot, then open the file for the user (`open` on macOS, `xdg-open` on Linux).
- **Claude.ai / Claude Desktop (no shell or Chrome)**: render the HTML in the environment's preview/artifact view and inspect it there before sharing. Same checks, different lens.

Either way, check: titles not truncated, no overlap, tree reads top-to-bottom, photos loaded, nothing off-screen. Fix what's wrong, re-review, and only then hand it to the user. Designing blind is why this took 10 tries once - don't.

## Rules
- A flat "exec + list of their department" is a directory, not an org chart. Build **nesting** (managers with reports under them).
- Structure from authoritative sources (The Org / filings), people+photos from Crustdata. Never rank importance by follower/connection count.
- Curate to the verifiable few; drop what you can't confidently place. No fabricated people, titles, or reporting lines - label any inferred edge as inferred.
- Output is always a standalone HTML file with real photos, self-reviewed via screenshot first.
