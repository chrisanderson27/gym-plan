# gym-plan

Offline-first iPhone PWA that suggests a balanced workout each day — Upper/Lower lifting with automatic
progression, a REGYMEN-style Burn class, runs, swims and hybrids — tracks weights per machine and the
bodyweight trend, and logs tagged feedback for later AI iteration.

- **Install:** open `https://chrisanderson27.github.io/gym-plan/` in Safari → Share → Add to Home Screen.
- **Data:** stays on the phone (IndexedDB). Nothing is uploaded. Back up with Settings → Export.
- ⚠️ **The Pages URL is the data's permanent home.** iOS scopes storage per origin: renaming this repo
  or moving hosts opens an empty app. Export first, import after.
- **Never commit personal data** — exports and feedback `.jsonl` files are gitignored.

## Develop

```
npm ci
npm run dev          # Vite dev server
npm run typecheck && npm run lint && npm test
npm run build        # also emits dist/sw.js and the manifest
npx playwright install webkit   # once
npm run test:e2e     # builds, serves :4173 via vite preview, runs the webkit project
```

## Restore

Settings → Import merges a backup into the device: the file's rows win on a clash, rows only on the
device are never deleted, and settings come from the file only when it is newer.

Spec: PRD 1 lives in Chris's wiki at `.planning/gym-plan/prds/prd-1-gym-plan-mvp.md` (with the research
behind it in `.planning/gym-plan/research/`).
