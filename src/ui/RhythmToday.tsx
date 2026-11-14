// Dygnsrytm, today's estimate at the top of Hem, kept short: what changed, how much, one step
// from the person's own plan when there is a change, how fresh it is, and a way to the details.
// No reasons, no values and no pulse share here: those are on the Dygnsrytm screen. Shown only
// when the person has chosen the function. Opening the details marks a new change as read.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatDateSv, formatTime, toDateKey } from '../core/analysis/dates';
import { changeHeadline, changeScope, STABLE_TITLE, type RhythmAssessment } from '../core/analysis/rhythm';
import { latestRhythm, markRhythmSeen, planStepFor, rhythmCard, rhythmMode } from '../services/rhythm';
import { Card, Tag } from './components';
import { useNav } from './nav';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

/** What the estimate says, in a few words: the heading, and how much it is. */
export function rhythmHeadline(a: RhythmAssessment): { title: string; detail: string } {
  if (a.status === 'insufficient') return { title: 'För lite data', detail: a.insufficient?.reason === 'baseline' ? 'Appen lär sig ditt mönster.' : a.insufficient?.reason === 'timezone' ? 'Ny tidszon.' : 'Klockan saknar nätter.' };
  if (a.status === 'stable') return { title: STABLE_TITLE, detail: a.singleShort ? 'En enstaka kort natt räknas inte.' : '' };
  return { title: changeHeadline(a.changes), detail: changeScope(a.changes) };
}

const MONTH = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;

/** "Natten till 14 nov · hämtat 08:00": the latest night it rests on, and when the watch's data were last fetched. */
export function rhythmFreshness(a: RhythmAssessment, lastSyncAt: string | null | undefined, now = new Date()): string {
  const fetched = lastSyncAt ? (toDateKey(new Date(lastSyncAt)) === toDateKey(now) ? formatTime(lastSyncAt) : `${shortDate(toDateKey(new Date(lastSyncAt)))} ${formatTime(lastSyncAt)}`) : null;
  return `Natten till ${shortDate(a.covers.to)}${fetched ? ` · hämtat ${fetched}` : ''}`;
}

export function RhythmToday() {
  const repo = useRepo();
  const nav = useNav();
  if (rhythmMode(repo) === 'off') return null;
  const a = latestRhythm(repo);
  if (!a) return null;
  const fresh = rhythmCard(repo);
  const head = rhythmHeadline(a);
  const freshness = rhythmFreshness(a, repo.garminStatus().lastSyncAt);
  const step = a.status === 'change' ? planStepFor(repo, a) : null;
  const old = a.date !== toDateKey(new Date());
  const open = () => {
    if (fresh) markRhythmSeen(repo, fresh.id);
    nav.push({ name: 'rhythm' });
  };
  return (
    // Neutral on purpose: the level's colours belong to the evening's traffic light, not to the watch.
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Dygnsrytm${old ? `, ${formatDateSv(a.date)}` : ' i dag'}: ${head.title}. ${head.detail}${step ? ` Ur din plan: ${step.text}.` : ''} ${freshness}.`}
      accessibilityHint="Visar detaljerna"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Card style={{ paddingVertical: space.s, minHeight: MIN_TOUCH }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text style={type.label}>{`Dygnsrytm${old ? ` ${formatDateSv(a.date)}` : ''}`.toUpperCase()}</Text>
          {fresh ? <Tag label="Ny" /> : null}
          <View style={{ flex: 1 }} />
          <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>Visa detaljer ›</Text>
        </View>
        <Text style={[type.body, { fontWeight: '600' }]}>{head.title}</Text>
        {head.detail ? <Text style={type.body}>{head.detail}</Text> : null}
        {step ? <Text style={[type.body, { marginTop: space.xs }]} numberOfLines={2}><Text style={{ fontWeight: '600' }}>Ur din plan: </Text>{step.text}</Text> : null}
        <Text style={[type.small, { marginTop: space.xs }]}>{freshness}</Text>
      </Card>
    </Pressable>
  );
}
