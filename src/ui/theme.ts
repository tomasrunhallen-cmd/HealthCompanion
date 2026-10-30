import type { Level } from '../domain/types';

export const colors = {
  bg: '#FBF8F3',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EEE6',
  border: '#E6DFD3',
  text: '#2B2A28',
  textMuted: '#6E6A63',
  accent: '#B8651B',
  accentSoft: '#F6E7D6',
  green: '#3F8F5B',
  greenSoft: '#E3F1E7',
  yellow: '#C99512',
  yellowSoft: '#FBF0D2',
  red: '#B9443A',
  redSoft: '#F7E1DE',
  danger: '#9E3A31',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };

export const radius = { s: 8, m: 12, l: 20, pill: 999 };

export const type = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 19, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  small: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 0.3 },
};

export const LEVEL_TEXT: Record<Level, string> = { green: 'Grönt', yellow: 'Gult', red: 'Rött' };

export function levelColor(level: Level): string {
  return level === 'green' ? colors.green : level === 'yellow' ? colors.yellow : colors.red;
}

export function levelSoft(level: Level): string {
  return level === 'green' ? colors.greenSoft : level === 'yellow' ? colors.yellowSoft : colors.redSoft;
}
