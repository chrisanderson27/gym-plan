# e2e profile — gym-plan

- **App:** offline-first PWA, Vite + Preact. Served for e2e by `vite preview` at
  `http://localhost:4173/gym-plan/` (Vite `base: '/gym-plan/'`).
- **Auth:** none. Single user, all data in IndexedDB on the device.
- **First run:** onboarding asks bodyweight, goal weight, pool unit and length. A fresh browser
  profile always lands there; clear site data to reset.
- **Viewport:** design target is an iPhone (one-handed, dark mode default). Prefer a ~390×844 viewport.
- **Service worker:** registers with `registerType: 'prompt'`; an update shows a prompt, never reloads.

## Learned quirks
<!-- e2e workers append here -->
