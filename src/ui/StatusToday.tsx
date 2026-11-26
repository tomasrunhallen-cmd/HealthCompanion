// Senaste veckan inside Rutiner i dag: what the person has done with their routines, in the
// app's own words. Silent when there is nothing concrete. See core/plan/status.ts.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { statusFacts } from '../core/plan/status';
import { statusInput } from '../services/status';
import { Button, Card, P } from './components';
import { useNav } from './nav';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

/** A week when Hjälp nu was shown: first on Hem, where help is, and nothing about routines. */
export function StatusHelp() {
  const repo = useRepo();
  const nav = useNav();
  const f = statusFacts(statusInput(repo));
  if (f.tone !== 'plan') return null;
  return (
    <Card style={{ marginTop: space.s }}>
      <P>Den här veckan visade appen Hjälp nu. Din plan och hjälpen finns här.</P>
      <Button kind="secondary" title="Hjälp nu" onPress={() => nav.push({ name: 'crisis' })} />
    </Card>
  );
}

/**
 * Inside Rutiner i dag: what the person has done with their routines the latest week, in the
 * app's own sentences. The first sentence when the card is folded, all of them when it is open.
 * Silent with nothing concrete, and in a week when Hjälp nu was shown.
 */
export function RoutineWeekLines({ open }: { open: boolean }) {
  const repo = useRepo();
  const [why, setWhy] = useState(false);
  // Drawn from what is saved every time, so a red check-in or a stopped note shows at once.
  const f = statusFacts(statusInput(repo));
  if (f.tone === 'plan' || !f.lines.length) return null;
  const shown = open ? f.lines : f.lines.slice(0, 1);
  return (
    <View style={{ marginTop: space.s, paddingBottom: space.s, borderBottomWidth: 1, borderColor: colors.border }} accessible={!open} accessibilityLabel={!open ? `Senaste 7 dagarna: ${shown[0].text}` : undefined}>
      <Text style={type.label}>SENASTE 7 DAGARNA</Text>
      {shown.map((l) => <Text key={l.text} style={[type.small, { marginTop: 2, color: colors.text }]}>{l.text}</Text>)}
      {open ? (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: why }} onPress={() => setWhy((v) => !v)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{why ? 'Dölj vad det bygger på' : 'Vad bygger det på?'}</Text>
          </Pressable>
          {why ? f.basis.map((b) => <Text key={b} style={[type.small, { marginTop: 2 }]}>{b}</Text>) : null}
        </>
      ) : null}
    </View>
  );
}
