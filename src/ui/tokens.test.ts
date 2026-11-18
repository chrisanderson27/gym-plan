import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declaration body of the block that opens with `selector {` (first occurrence at/after `from`). */
function block(selector: string, from = 0): string {
  const at = css.indexOf(selector + ' {', from);
  if (at < 0) throw new Error(`missing block: ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const root = decls(block(':root'));
const light = decls(block(":root, [data-theme='light'], [data-theme='system']"));
const dark = decls(block("[data-theme='dark']"));
const systemDark = decls(block("[data-theme='system']", css.indexOf('@media (prefers-color-scheme: dark)')));
// Component tokens live only in the light block and re-resolve per theme, so dark layers over light.
const themes = { light: { ...root, ...light }, dark: { ...root, ...light, ...dark } } as const;

function resolve(map: Record<string, string>, token: string, depth = 0): string {
  if (depth > 10) throw new Error(`var() cycle at ${token}`);
  const v = map[`--${token}`];
  if (v === undefined) throw new Error(`missing token --${token}`);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(map, ref[1]!, depth + 1) : v;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const BODY = 4.5;
const NONTEXT = 3;
const PAIRS: [string, string, number][] = [
  ['color-text-primary', 'color-canvas', BODY],
  ['color-text-primary', 'color-surface', BODY],
  ['color-text-primary', 'color-surface-hover', BODY],
  ['color-text-secondary', 'color-canvas', BODY],
  ['color-text-secondary', 'color-surface', BODY],
  ['color-link', 'color-canvas', BODY],
  ['color-link', 'color-surface', BODY],
  ['color-on-action', 'color-action', BODY],
  ['color-on-action', 'color-action-hover', BODY],
  ['color-on-action', 'color-action-active', BODY],
  ['color-success-text', 'color-success-tint', BODY],
  ['color-warning-text', 'color-warning-tint', BODY],
  ['color-danger-text', 'color-danger-tint', BODY],
  ['color-info-text', 'color-info-tint', BODY],
  ['color-danger-text', 'color-surface', BODY],
  ['chip-on-text', 'chip-on-bg', BODY],
  ['color-on-danger', 'chip-danger-on-bg', BODY],
  ['color-text-primary', 'chip-bg', BODY],
  ['button-text', 'button-bg', BODY],
  ['color-text-primary', 'input-bg', BODY],
  ['input-border', 'color-surface', NONTEXT],
  ['input-border', 'color-canvas', NONTEXT],
  ['chip-border', 'color-surface', NONTEXT],
  ['chip-border', 'color-canvas', NONTEXT],
  ['color-focus', 'color-canvas', NONTEXT],
  ['color-focus', 'color-surface', NONTEXT],
  ['color-action', 'color-surface', NONTEXT],
  ['color-success-text', 'color-surface', NONTEXT],
];
const TIMER: [string, string, number][] = [
  ...['timer-idle', 'timer-work', 'timer-rest', 'timer-warmup', 'timer-transition'].map((f): [string, string, number] => ['timer-text', f, BODY]),
  ['timer-primary-text', 'timer-primary-bg', BODY],
];

describe('design tokens: WCAG contrast', () => {
  for (const name of ['light', 'dark'] as const) {
    it.each(PAIRS)(`${name}: %s on %s >= %f`, (fg, bg, min) => {
      const r = ratio(resolve(themes[name], fg), resolve(themes[name], bg));
      expect(r, `${name}: ${fg} on ${bg} = ${r.toFixed(2)} (need ${min})`).toBeGreaterThanOrEqual(min);
    });
  }
  it.each(TIMER)('timer: %s on %s >= %f', (fg, bg, min) => {
    const r = ratio(resolve(themes.light, fg), resolve(themes.light, bg));
    expect(r, `timer: ${fg} on ${bg} = ${r.toFixed(2)} (need ${min})`).toBeGreaterThanOrEqual(min);
  });
});

describe('design tokens: structure', () => {
  it('system-dark block equals the dark block', () => {
    expect(systemDark).toEqual(dark);
  });
  it('light and dark declare the same --color-* keys', () => {
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith('--color-')).sort();
    expect(keys(dark)).toEqual(keys(light));
  });
});

describe('design tokens: no colour literals outside tokens.css', () => {
  const srcRoot = join(__dirname, '..');
  const files = (readdirSync(srcRoot, { recursive: true }) as string[])
    .map((f) => f.split('\\').join('/'))
    .filter((f) => /\.(css|ts|tsx)$/.test(f) && f !== 'ui/tokens.css' && !f.endsWith('.test.ts'));

  it('scans files', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it('has no hex / rgb() / hsl() literals', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(join(srcRoot, f), 'utf8').split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
  it('has no fill=/stroke= JSX colour attributes in ui tsx', () => {
    const hits = files
      .filter((f) => f.startsWith('ui/') && f.endsWith('.tsx'))
      .filter((f) => /\b(fill|stroke)="/.test(readFileSync(join(srcRoot, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
