// Klockans rytm, today's estimate at the top of Hem: one plain line folded, the model's reasons
// when opened. Shown only when the person has chosen the function. Opening it marks a new change
// as read, the same way the card did before.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatDateSv, formatTime, toDateKey } from '../core/analysis/dates';
import { PATTERN_WORD, type RhythmAssessment } from '../core/analysis/rhythm';
import { latestRhythm, markRhythmSeen, planStepFor, rhythmCard, rhythmMode } from '../services/rhythm';
import { Button, Card, P, Tag } from './components';
import { useNav } from './nav';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

/** The folded line: what the estimate says, in a few words. */
export function rhythmHeadline(a: RhythmAssessment): { title: string; detail: string } {
  if (a.status === 'insufficient') return { title: 'För lite data', detail: a.insufficient?.reason === 'baseline' ? 'Appen lär sig ditt vanliga mönster' : a.insufficient?.reason === 'timezone' ? 'Efter ett tidszonsbyte' : 'Klockan saknar några nätter' };
  if (a.status === 'stable') return { title: 'Ingen förändring', detail: a.singleShort ? 'En enstaka kort natt, inget mer' : 'Sömn och dygnsrytm som vanligt' };
  // At most two patterns in the line, so it stays one or two lines; the rest are under Varför.
  const words = a.changes.slice(0, 2).map((c) => PATTERN_WORD[c.pattern]);
  const what = words.join(' och ') + (a.changes.length > 2 ? ' m.m.' : '');
  const dir = a.direction?.value === 'up' ? 'Riktning uppåt, enligt din historik' : a.direction?.value === 'down' ? 'Riktning nedåt, enligt din historik' : 'Riktning oklar';
  return { title: what, detail: dir };
}

export function RhythmToday() {
  const repo = useRepo();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  if (rhythmMode(repo) === 'off') return null;
  const a = latestRhythm(repo);
  if (!a) return null;
  const fresh = rhythmCard(repo);
  const head = rhythmHeadline(a);
  const step = a.status === 'change' ? planStepFor(repo, a) : null;
  const old = a.date !== toDateKey(new Date());
  const toggle = () => {
    if (!open && fresh) markRhythmSeen(repo, fresh.id);
    setOpen(!open);
  };
  return (
    <Card tone={a.status === 'change' ? 'yellow' : undefined} style={{ paddingVertical: space.s }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`Klockans rytm${old ? `, ${formatDateSv(a.date)}` : ' i dag'}: ${head.title}. ${head.detail}.`}
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Fäller ihop motiveringen' : 'Visar motiveringen'}
        style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.s }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: '600' }]}>Klockans rytm{old ? ` ${formatDateSv(a.date)}` : ''}: {head.title.charAt(0).toLowerCase() + head.title.slice(1)}</Text>
          <Text style={type.small}>{head.detail}</Text>
        </View>
        {fresh ? <Tag label="Ny" /> : null}
        <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]} importantForAccessibility="no">{open ? 'Dölj ▲' : 'Varför ▼'}</Text>
      </Pressable>
      {open ? (
        <View style={{ marginTop: space.xs }}>
          <P>{a.text.change}</P>
          {a.text.direction ? <P style={{ marginTop: space.xs }}>{a.text.direction}</P> : null}
          <P muted style={{ marginTop: space.xs }}>Bedömd {formatTime(a.computedAt)}, nätterna {formatDateSv(a.covers.from)} – {formatDateSv(a.covers.to)}.</P>
          {step ? (
            <View style={{ marginTop: space.s }}>
              <Text style={type.label}>{step.heading.toUpperCase()}</Text>
              <P>{step.text}</P>
            </View>
          ) : null}
          <Button kind="ghost" title="Öppna jämförelsen" onPress={() => nav.push({ name: 'rhythm' })} />
        </View>
      ) : null}
    </Card>
  );
}
