# gym-plan

Offline-first iPhone PWA that suggests a balanced workout each day — Upper/Lower lifting with automatic
progression, a REGYMEN-style Burn class, runs, swims and hybrids — tracks weights per machine and the
bodyweight trend, and logs tagged feedback for later AI iteration.

- **Install:** open `https://chrisanderson27.github.io/gym-plan/` in Safari → Share → Add to Home Screen.
- **Data:** stays on the phone (IndexedDB). Nothing is uploaded. Back up with Settings → Export.
- ⚠️ **The Pages URL is the data's permanent home.** iOS scopes storage per origin: renaming this repo
  or moving hosts opens an empty app. Export first, import after.
- **Never commit personal data** — exports and feedback `.jsonl` files are gitignored.

Spec: PRD 1 lives in Chris's wiki at `.planning/gym-plan/prds/prd-1-gym-plan-mvp.md` (with the research
behind it in `.planning/gym-plan/research/`).
