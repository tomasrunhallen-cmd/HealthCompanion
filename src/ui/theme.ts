// Colours, spacing and type. Light and dark appearance (HIG: Color, Dark Mode).
//
// iOS: text, backgrounds and separators are the system's semantic colours (PlatformColor),
// so they follow light and dark mode and Increase Contrast. The app's own colours (the
// accent and the three levels) are dynamic pairs (DynamicColorIOS). Web: CSS variables that
// follow prefers-color-scheme. Android: the pair for the appearance at start.
//
// Every level colour has at least 4.5:1 contrast against the backgrounds it is drawn on, in
// both appearances (computed in DESIGN.md). The level is never shown by colour alone: each
// level also has a word and its own symbol (LevelSymbol in components.tsx).

import { Appearance, DynamicColorIOS, Platform, PlatformColor, type ColorValue } from 'react-native';
import type { Level } from '../domain/types';

interface Pair {
  light: string;
  dark: string;
}

/** Light and dark values. On iOS the semantic ones are only the web and Android fallback. */
export const PALETTE = {
  bg: { light: '#F2F2F7', dark: '#000000' },
  surface: { light: '#FFFFFF', dark: '#1C1C1E' },
  surfaceAlt: { light: '#E9E9EE', dark: '#2C2C2E' },
  border: { light: '#C6C6C8', dark: '#38383A' },
  text: { light: '#000000', dark: '#FFFFFF' },
  textMuted: { light: '#5F5F64', dark: '#AEAEB2' },
  placeholder: { light: '#8E8E93', dark: '#8E8E93' },
  accent: { light: '#9C500D', dark: '#F2A65A' },
  onAccent: { light: '#FFFFFF', dark: '#1C1C1E' },
  accentSoft: { light: '#F6E7D6', dark: '#3A2612' },
  green: { light: '#2B7A4B', dark: '#5FD38A' },
  greenSoft: { light: '#E3F1E7', dark: '#11301E' },
  yellow: { light: '#8A5F00', dark: '#F2C14E' },
  yellowSoft: { light: '#FBF0D2', dark: '#33290A' },
  red: { light: '#B3261E', dark: '#FF8A80' },
  redSoft: { light: '#F9E3E0', dark: '#3D1916' },
  danger: { light: '#B3261E', dark: '#FF8A80' },
  onDanger: { light: '#FFFFFF', dark: '#1C1C1E' },
} satisfies Record<string, Pair>;

type Token = keyof typeof PALETTE;

/** iOS system colours for text and backgrounds (HIG: "Prefer the system background colors"). */
const IOS_SEMANTIC: Partial<Record<Token, string>> = {
  bg: 'systemGroupedBackground',
  surface: 'secondarySystemGroupedBackground',
  surfaceAlt: 'tertiarySystemGroupedBackground',
  border: 'separator',
  text: 'label',
  textMuted: 'secondaryLabel',
  placeholder: 'placeholderText',
};

function token(name: Token): ColorValue {
  if (Platform.OS === 'ios') {
    const semantic = IOS_SEMANTIC[name];
    return semantic ? PlatformColor(semantic) : DynamicColorIOS(PALETTE[name]);
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

export const radius = { s: 8, m: 12, l: 20, pill: 999 };

/** HIG: the default text size is 17 pt and the minimum 11 pt. */
export const MIN_TOUCH = 44;

/**
 * Text styles on the system font (SF Pro on iOS), close to the iOS text styles: Large Title,
 * Title 3, Body, Subheadline and Footnote. React Native scales them with Dynamic Type.
 */
export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 17, lineHeight: 22, color: colors.text },
  small: { fontSize: 15, lineHeight: 20, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 0.3 },
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
