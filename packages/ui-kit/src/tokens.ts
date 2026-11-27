/** Дизайн-токены палитры «янтарь — индиго» (CONCEPT §4). */
export const COLORS = {
  'amber-100': '#fff2d6',
  'amber-300': '#f6c56b',
  'amber-500': '#e09a2a',
  'amber-700': '#9c6316',
  'indigo-100': '#dfe3ff',
  'indigo-300': '#8f99e8',
  'indigo-500': '#4a52b8',
  'indigo-700': '#2a2d72',
  'indigo-900': '#14163a',
  'dusk-950': '#0b0c1f',
  text: '#f2efe6',
  'text-muted': '#b6b3c8',
  danger: '#e0564a',
  success: '#6fbf73',
  warning: '#e8b04a',
} as const;
export type ColorToken = keyof typeof COLORS;

export const SPACING = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
export const RADIUS = { s: 4, m: 8, l: 14 } as const;

export interface TokenOptions {
  /** Масштаб интерфейса `0.75..1.5`. */
  uiScale?: number;
  /** Базовый размер шрифта `12..20` px. */
  fontSize?: number;
  reduceMotion?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** CSS-переменные токенов для `:root`. */
export function cssVariables(o: TokenOptions = {}): Record<string, string> {
  const scale = clamp(o.uiScale ?? 1, 0.75, 1.5);
  const font = clamp(o.fontSize ?? 14, 12, 20);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(COLORS)) vars[`--dm-${k}`] = v;
  for (const [k, v] of Object.entries(SPACING))
    vars[`--dm-space-${k}`] = `${Math.round(v * scale)}px`;
  for (const [k, v] of Object.entries(RADIUS))
    vars[`--dm-radius-${k}`] = `${Math.round(v * scale)}px`;
  vars['--dm-font-size'] = `${Math.round(font * scale)}px`;
  vars['--dm-motion'] = o.reduceMotion ? '0ms' : '160ms';
  return vars;
}

/** Применение токенов к корневому элементу. */
export function applyTokens(root: HTMLElement, o: TokenOptions = {}): void {
  for (const [k, v] of Object.entries(cssVariables(o))) root.style.setProperty(k, v);
}

/** Базовые стили компонентов (одна вставка `<style>` на документ). */
export const BASE_CSS = `
.dm-root{background:var(--dm-dusk-950);color:var(--dm-text);font-size:var(--dm-font-size);font-family:system-ui,sans-serif}
.dm-button{border:1px solid var(--dm-amber-500);background:var(--dm-amber-500);color:var(--dm-dusk-950);border-radius:var(--dm-radius-m);padding:var(--dm-space-2) var(--dm-space-4);cursor:pointer;transition:filter var(--dm-motion)}
.dm-button[data-variant=ghost]{background:transparent;color:var(--dm-amber-300)}
.dm-button[data-variant=danger]{background:var(--dm-danger);border-color:var(--dm-danger);color:var(--dm-text)}
.dm-button:disabled{opacity:.5;cursor:not-allowed}
.dm-field{display:flex;flex-direction:column;gap:var(--dm-space-1)}
.dm-field input{background:var(--dm-indigo-900);color:var(--dm-text);border:1px solid var(--dm-indigo-500);border-radius:var(--dm-radius-s);padding:var(--dm-space-2)}
.dm-field[data-invalid] input{border-color:var(--dm-danger)}
.dm-field .dm-error{color:var(--dm-danger)}
.dm-field .dm-hint{color:var(--dm-text-muted)}
.dm-panel{background:var(--dm-indigo-900);border:1px solid var(--dm-indigo-700);border-radius:var(--dm-radius-l);padding:var(--dm-space-4)}
.dm-dialog-backdrop{position:fixed;inset:0;background:rgb(11 12 31 / 70%);display:grid;place-items:center}
.dm-notice{border-radius:var(--dm-radius-m);padding:var(--dm-space-3);border-left:4px solid var(--dm-indigo-300);background:var(--dm-indigo-900)}
.dm-notice[data-tone=error]{border-color:var(--dm-danger)}
.dm-notice[data-tone=warning]{border-color:var(--dm-warning)}
.dm-notice[data-tone=success]{border-color:var(--dm-success)}
.dm-skeleton{background:linear-gradient(90deg,var(--dm-indigo-900),var(--dm-indigo-700),var(--dm-indigo-900));border-radius:var(--dm-radius-s);min-height:1em}
`;

export function injectBaseStyles(doc: Document = document): void {
  if (doc.getElementById('dm-ui-kit')) return;
  const style = doc.createElement('style');
  style.id = 'dm-ui-kit';
  style.textContent = BASE_CSS;
  doc.head.append(style);
}
