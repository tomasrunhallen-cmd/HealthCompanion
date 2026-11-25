// One night's sleep phases as a bar, with every phase also in words and minutes, so the colour is
// never the only carrier. Background only: the phases never count in the day's level.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { incomplete, minutesText, PHASE_WORD, phasesText, type PhasePart, type SleepPhase } from '../core/analysis/sleepPhases';
import { colors, MIN_TOUCH, radius, space, type } from './theme';

/** Shades of the one accent, darkest for deep sleep; awake in the neutral line colour. */
const FILL: Record<SleepPhase, { color: typeof colors.accent; opacity: number }> = {
  deep: { color: colors.accent, opacity: 1 },
  rem: { color: colors.accent, opacity: 0.6 },
  light: { color: colors.accent, opacity: 0.3 },
  awake: { color: colors.border, opacity: 1 },
};

export function SleepPhasesBar(props: { parts: PhasePart[]; label?: string; compact?: boolean; nights?: number }) {
  const { parts, nights } = props;
  // A phase the watch did not give is "saknas", never 0, and the bar then shows only what is known.
  const known = parts.filter((p) => p.minutes != null && (p.share ?? 0) > 0);
  const coverage = (p: PhasePart) => (nights && p.nights != null && p.nights < nights ? ` · ${p.nights} av ${nights} nätter` : '');
  return (
    <View accessible accessibilityLabel={`${props.label ? `${props.label}: ` : ''}${phasesText(parts)}`} style={{ marginTop: space.xs }}>
      {props.label ? <Text style={type.small}>{props.label}</Text> : null}
      <View style={{ flexDirection: 'row', height: props.compact ? 10 : 14, borderRadius: radius.xs, overflow: 'hidden', backgroundColor: colors.surfaceAlt, marginTop: space.xs }}>
        {known.map((p) => (
          <View key={p.phase} style={{ flex: p.share ?? 0, backgroundColor: FILL[p.phase].color, opacity: FILL[p.phase].opacity }} />
        ))}
      </View>
      {props.compact ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs, columnGap: space.m, rowGap: space.xs }}>
          {parts.map((p) => (
            <View key={p.phase} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {p.minutes != null ? <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: FILL[p.phase].color, opacity: FILL[p.phase].opacity, marginRight: space.xs }} /> : null}
              <Text style={type.small}>{p.minutes == null ? `${PHASE_WORD[p.phase]} saknas` : `${PHASE_WORD[p.phase]} ${minutesText(p.minutes)} · ${Math.round((p.share ?? 0) * 100)} %${coverage(p)}`}</Text>
            </View>
          ))}
        </View>
      )}
      {!props.compact && incomplete(parts) ? <Text style={[type.small, { marginTop: space.xs }]}>Andelarna gäller bara faserna som finns.</Text> : null}
    </View>
  );
}

/** The note that goes with the phases wherever they are shown (granskning 25 november). */
export const PHASES_NOTE = 'Klockan uppskattar sömnfaserna. En enskild natts fördelning är osäker. Faserna ger inga poäng i ampeln.';

/** A single night's phases, behind a tap: sleep times and length come first, the uncertain split after. */
export function SleepPhasesToggle(props: { parts: PhasePart[]; label?: string; note?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Dölj sömnfaser' : 'Visa sömnfaser'}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
      >
        <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{open ? 'Dölj sömnfaser' : 'Visa sömnfaser'}</Text>
      </Pressable>
      {open ? (
        <>
          <SleepPhasesBar parts={props.parts} label={props.label} />
          {props.note === false ? null : <Text style={[type.small, { marginTop: space.xs }]}>{PHASES_NOTE}</Text>}
        </>
      ) : null}
    </View>
  );
}
