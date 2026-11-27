// Sömn och dygnsrytm on Hem: one way in for the night and the watch (granskning 27 november).
// The whole card is one button. Under the heading: last night, the sleep notice when there is one,
// and Dygnsrytm's heading when the person has chosen it. When the fetched time is fresh it is on
// the detail screen; when data are missing or old, or the fetch failed, that shows here at once.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, formatDateSv, formatTime, toDateKey } from '../core/analysis/dates';
import { FROM_SOURCE } from '../core/analysis/sources';
import { latestRhythm, markRhythmSeen, planStepFor, rhythmCard, rhythmMode } from '../services/rhythm';
import { NOTICE_KEY, todaysSleepNotice } from '../services/sleepNotice';
import { sleepDrop } from '../core/analysis/sleepNotice';
import { Button, Card, Tag } from './components';
import { useNav } from './nav';
import { rhythmHeadline } from './RhythmToday';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Something about the night or the watch that needs attention today: then the card comes before the routines. */
export function sleepAttention(repo: ReturnType<typeof useRepo>, today: string): boolean {
  const garmin = repo.garminStatus();
  const night = repo.measuredDay(today);
  const a = rhythmMode(repo) !== 'off' ? latestRhythm(repo) : null;
  if (a?.status === 'change' || todaysSleepNotice(repo)) return true;
  if (garmin.connected && (!night || garmin.lastError || (garmin.lastSyncAt && toDateKey(new Date(garmin.lastSyncAt)) < addDays(today, -1)))) return true;
  return !!sleepDrop(repo.measuredDays(), today);
}

export function SleepAndRhythm({ today }: { today: string }) {
  const repo = useRepo();
  const nav = useNav();
  const garmin = repo.garminStatus();
  const night = repo.measuredDay(today);
  const rhythmOn = rhythmMode(repo) !== 'off';
  const a = rhythmOn ? latestRhythm(repo) : null;
  const fresh = rhythmOn ? rhythmCard(repo) : null;
  const step = a?.status === 'change' ? planStepFor(repo, a) : null;
  const note = a?.status === 'change' ? null : todaysSleepNotice(repo);
  const hasSource = garmin.connected || night != null || rhythmOn;
  if (!hasSource) return null;

  const lines: { text: string; strong?: boolean; warn?: boolean }[] = [];
  if (night?.sleepHours != null) {
    lines.push({ text: `I natt: ${dec(night.sleepHours)} h${night.sleepStart ? `, somnade ${night.sleepStart}` : ''}${night.source && night.source !== 'garmin' ? ` (${FROM_SOURCE[night.source]})` : ''}.` });
  } else if (garmin.connected) {
    lines.push({ text: 'Ingen natt från klockan än i dag.', warn: true });
  }
  if (garmin.connected && garmin.lastError) lines.push({ text: `Hämtningen misslyckades: ${garmin.lastError}`, warn: true });
  else if (garmin.connected && garmin.lastSyncAt && toDateKey(new Date(garmin.lastSyncAt)) < addDays(today, -1)) {
    lines.push({ text: `Senast hämtat ${formatDateSv(toDateKey(new Date(garmin.lastSyncAt)))} ${formatTime(garmin.lastSyncAt)}.`, warn: true });
  }
  const drop = sleepDrop(repo.measuredDays(), today);
  if (drop) lines.push({ text: `Snitt de senaste tre nätterna: ${dec(drop.recent)} timmar. Ditt tidigare snitt: ${dec(drop.usual)} timmar.`, strong: true });
  if (a) {
    const head = rhythmHeadline(a);
    lines.push({ text: `Dygnsrytm: ${head.title}${head.detail ? `. ${head.detail}` : ''}`, strong: a.status === 'change' });
  }
  if (step) lines.push({ text: `Ur din plan: ${step.text}` });

  const open = () => {
    if (fresh) markRhythmSeen(repo, fresh.id);
    nav.push({ name: rhythmOn ? 'rhythm' : 'garmin' });
  };
  return (
    <Card style={{ marginTop: space.s }}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Sömn och dygnsrytm. ${lines.map((l) => l.text).join(' ')}`}
        accessibilityHint="Visar detaljerna"
        style={({ pressed }) => ({ minHeight: MIN_TOUCH, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TOUCH }}>
          <Text style={[type.h2, { flex: 1 }]}>Sömn och dygnsrytm</Text>
          {fresh ? <Tag label="Ny" /> : null}
          <Text style={[type.h2, { color: colors.accent }]} importantForAccessibility="no">›</Text>
        </View>
        {lines.map((l) => (
          <Text key={l.text} style={[type.body, l.strong ? { fontWeight: '600' } : null, l.warn ? { color: colors.textMuted } : null]}>{l.text}</Text>
        ))}
      </Pressable>
      {note ? (
        <View style={{ marginTop: space.s }}>
          <Text style={[type.body, { fontWeight: '600' }]}>{note.title}</Text>
          <Text style={type.body}>{note.body}</Text>
          <Button kind="ghost" title="Okej" onPress={() => repo.kvSet(NOTICE_KEY, { ...note, dismissed: true })} />
        </View>
      ) : null}
    </Card>
  );
}
