// Senaste veckan on Hem: what the person has done with their routines, in the app's own words,
// folded to one line. Silent when there is nothing concrete. See core/plan/status.ts.

import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { statusFacts, type StatusTone } from '../core/plan/status';
import { statusInput } from '../services/status';
import { Button, Card, P } from './components';
import { useNav } from './nav';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

/** `place`: on a calm day the card stands first on Hem; on a yellow or red day after the week's levels. */
export function StatusToday({ place }: { place: 'top' | 'after' }) {
  const repo = useRepo();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  // Drawn from what is saved every time, so a red check-in or a stopped note shows at once.
  const f = statusFacts(statusInput(repo));
  const wanted: StatusTone[] = place === 'top' ? ['open', 'plan'] : ['quiet'];
  if (!wanted.includes(f.tone)) return null;

  if (f.tone === 'plan') {
    return (
      <Card style={{ marginTop: space.s }}>
        <P>Den här veckan visade appen Hjälp nu. Din plan och hjälpen finns här.</P>
        <Button kind="secondary" title="Hjälp nu" onPress={() => nav.push({ name: 'crisis' })} />
      </Card>
    );
  }
  if (!f.lines.length) return null;

  return (
    <Card style={{ marginTop: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Senaste veckan, dina rutiner. Dölj' : `Senaste veckan, dina rutiner: ${f.lines.map((l) => l.text).join(' ')}`}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
      >
        <Text style={type.label}>{`SENASTE VECKAN · DINA RUTINER  ${open ? '▲' : '▼'}`}</Text>
        {open ? null : <Text style={[type.small, { marginTop: 2 }]} numberOfLines={1}>{f.lines[0].text}</Text>}
      </Pressable>
      {open ? (
        <>
          {f.lines.map((l) => <P key={l.text} style={{ marginTop: space.xs }}>{l.text}</P>)}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: why }} onPress={() => setWhy((v) => !v)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{why ? 'Dölj vad det bygger på' : 'Vad bygger det på?'}</Text>
          </Pressable>
          {why ? f.basis.map((b) => <P key={b} muted style={{ marginTop: space.xs }}>{b}</P>) : null}
        </>
      ) : null}
    </Card>
  );
}
