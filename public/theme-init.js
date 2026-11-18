// Pre-paint theme apply (CSP forbids inline scripts). Key must match src/ui/theme.ts APPEARANCE_KEY.
try {
  const t = localStorage.getItem('gym-plan:appearance');
  if (t === 'dark' || t === 'system' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch {
  /* storage blocked: keep the static light default */
}
