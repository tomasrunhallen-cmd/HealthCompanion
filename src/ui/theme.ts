// Colours, spacing and type, from the Dagsljus visual identity (2 November 2026): calm green
// tinted neutrals, one green accent, and the three levels. Light and dark appearance (HIG:
// Color, Dark Mode).
//
// Every colour is a light and dark pair: DynamicColorIOS on iOS (with stronger variants for
// Increase Contrast), CSS variables that follow prefers-color-scheme on the web, and the pair
// for the appearance at start on Android. Every text colour has at least 4.5:1 contrast against
// the backgrounds it is drawn on, in both appearances (computed in DESIGN.md). The level is
// never shown by colour alone: each level also has a word and its own symbol (LevelSymbol).

import { Appearance, DynamicColorIOS, Platform, type ColorValue } from 'react-native';
import type { Level } from '../core/domain/types';

interface Pair {
  light: string;
  dark: string;
}

/** Light and dark values. */
export const PALETTE = {
  bg: { light: '#F5F7F2', dark: '#101A16' },
  surface: { light: '#FFFFFF', dark: '#1A2922' },
  surfaceAlt: { light: '#E4EFE7', dark: '#263D30' },
  border: { light: '#D7E1D8', dark: '#3C5145' },
  text: { light: '#20372D', dark: '#EDF4EE' },
  textMuted: { light: '#53675C', dark: '#B1C5B8' },
  placeholder: { light: '#627569', dark: '#8EA396' },
  accent: { light: '#176B50', dark: '#99D8B8' },
  onAccent: { light: '#FFFFFF', dark: '#10271B' },
  accentSoft: { light: '#E4EFE7', dark: '#263D30' },
  green: { light: '#1F7A4A', dark: '#7FD9A4' },
  greenSoft: { light: '#E1F0E5', dark: '#173525' },
  yellow: { light: '#7E5700', dark: '#F2C14E' },
  yellowSoft: { light: '#F8EDCF', dark: '#33290A' },
  red: { light: '#963C35', dark: '#FFB4AA' },
  redSoft: { light: '#F7E4E1', dark: '#3D1F1B' },
  danger: { light: '#963C35', dark: '#FFB4AA' },
  onDanger: { light: '#FFFFFF', dark: '#10271B' },
} satisfies Record<string, Pair>;

/** iOS Increase Contrast: darker grey text and lines in light mode, lighter in dark mode. */
const HIGH_CONTRAST: Partial<Record<keyof typeof PALETTE, Pair>> = {
  textMuted: { light: '#3A4D42', dark: '#D3E2D8' },
  placeholder: { light: '#4B5E53', dark: '#B1C5B8' },
  border: { light: '#9DB0A3', dark: '#6B8576' },
};

type Token = keyof typeof PALETTE;

function token(name: Token): ColorValue {
  if (Platform.OS === 'ios') {
    const hc = HIGH_CONTRAST[name];
    return DynamicColorIOS({ ...PALETTE[name], ...(hc ? { highContrastLight: hc.light, highContrastDark: hc.dark } : {}) });
  }
  if (Platform.OS === 'web') return `var(--dl-${name})`;
  return PALETTE[name][Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];
}

export const colors = Object.fromEntries((Object.keys(PALETTE) as Token[]).map((k) => [k, token(k)])) as Record<Token, ColorValue>;

/** Web: the CSS variables behind `colors`, light by default and dark with the system setting. */
export function webThemeCss(): string {
  const vars = (mode: 'light' | 'dark') =>
    (Object.keys(PALETTE) as Token[]).map((k) => `--dl-${k}:${PALETTE[k][mode]};`).join('');
  return `:root{color-scheme:light dark;${vars('light')}}@media (prefers-color-scheme: dark){:root{${vars('dark')}}}` +
    'html,body{background:var(--dl-bg);}';
}

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('dl-theme')) {
  const el = document.createElement('style');
  el.id = 'dl-theme';
  el.textContent = webThemeCss();
  document.head.appendChild(el);
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };

/** Tags 6, inputs and buttons 15, cards 20, the soft hero card 24. */
export const radius = { xs: 6, s: 8, m: 15, l: 20, xl: 24, pill: 999 };

/** HIG: the default text size is 17 pt and the minimum 11 pt. */
export const MIN_TOUCH = 44;

/**
 * Text styles on the system font (SF Pro on iOS). Close to the iOS text styles: Large Title,
 * Title 3, Body, Subheadline and Footnote, with the identity's tight headings and spaced
 * capitals for small labels. React Native scales them with Dynamic Type.
 */
export const type = {
  title: { fontSize: 30, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.8, color: colors.text },
  h2: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.3, color: colors.text },
  body: { fontSize: 17, lineHeight: 24, color: colors.text },
  small: { fontSize: 15, lineHeight: 21, color: colors.textMuted },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 1.2 },
};

const REGULAR_WEIGHTS = Object.fromEntries(Object.entries(type).map(([k, v]) => [k, (v as { fontWeight?: string }).fontWeight]));
const HEAVIER: Record<string, string> = { undefined: '600', '600': '700', '700': '800' };

/**
 * iOS Bold Text. System text in UIKit gets bolder by itself; React Native text with an
 * explicit weight does not, so the app steps every style up one weight while it is on.
 */
export function applyBoldText(on: boolean): void {
  for (const [k, v] of Object.entries(type) as [keyof typeof type, { fontWeight?: string }][]) {
    const base = REGULAR_WEIGHTS[k];
    (v as { fontWeight?: string }).fontWeight = on ? HEAVIER[String(base)] : base;
  }
}

export const LEVEL_TEXT: Record<Level, string> = { green: 'Grönt', yellow: 'Gult', red: 'Rött' };

export function levelColor(level: Level): ColorValue {
  return level === 'green' ? colors.green : level === 'yellow' ? colors.yellow : colors.red;
}

export function levelSoft(level: Level): ColorValue {
  return level === 'green' ? colors.greenSoft : level === 'yellow' ? colors.yellowSoft : colors.redSoft;
}

/** The plain hex value for places that need a string, such as the browser's theme colour. */
export function paletteHex(name: Token, mode: 'light' | 'dark' = 'light'): string {
  return PALETTE[name][mode];
}
