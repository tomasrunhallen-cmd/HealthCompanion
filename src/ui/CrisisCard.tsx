// Shown at once when a note matches the emergency word list: the plan's own steps at red
// and the crisis numbers. The app contacts no one; tapping a number opens the phone's dialler.

import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { crisisInfo } from '../context/akut';
import type { PlanItem } from '../domain/types';
import { Card, P } from './components';
import { colors, space, type } from './theme';

export const MILD_TITLE = 'Om du har tankar på att inte vilja leva finns det hjälp att få';

/** `mild`: the note mentioned it with a negation ("vill inte dö"). Same help, gentler words. */
/** `sheet`: the "Hjälp nu" sheet, opened by the person, not by something they wrote. */
export function CrisisCard({ plan, mild = false, sheet = false }: { plan: PlanItem[]; mild?: boolean; sheet?: boolean }) {
  const { steps, ladder, numbers } = crisisInfo(plan);
  return (
    <Card style={{ borderColor: mild ? colors.border : colors.red, borderWidth: mild ? 1 : 2 }}>
      <Text style={type.h2} accessibilityRole="header">{mild ? MILD_TITLE : 'Du behöver inte vara ensam med det här'}</Text>
      {mild || sheet ? null : <P style={{ marginTop: space.xs }}>Det du skrev låter som att du har det mycket svårt just nu.</P>}

      <Text style={[type.label, { marginTop: space.m }]}>DIN PLAN VID RÖTT</Text>
      {steps.length ? (
        steps.map((s, i) => <P key={s + i} style={{ marginTop: space.xs }}>{`${i + 1}. ${s}`}</P>)
      ) : (
        <P muted style={{ marginTop: space.xs }}>Din plan har inga steg vid rött ännu.</P>
      )}

      {sheet && ladder ? (
        <>
          <Text style={[type.label, { marginTop: space.m }]} accessibilityRole="header">{ladder.heading.toUpperCase()}</Text>
          <P muted style={{ marginTop: 2 }}>Steg för steg, som i din plan.</P>
          {ladder.steps.map((s, i) => <P key={s + i} style={{ marginTop: space.xs }}>{`${i + 1}. ${s}`}</P>)}
        </>
      ) : null}

      <Text style={[type.label, { marginTop: space.m }]}>RING ELLER CHATTA</Text>
      {numbers.map((n) => (
        <Pressable
          key={n.number}
          accessibilityRole="link"
          accessibilityLabel={`Ring ${n.number}, ${n.label}`}
          accessibilityHint="Öppnar telefonens uppringning. Samtalet startar först när du trycker på ring där."
          onPress={() => Linking.openURL(`tel:${n.number}`).catch(() => undefined)}
          style={({ pressed }) => ({
            marginTop: space.s, padding: space.m, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
            backgroundColor: pressed ? colors.redSoft : colors.surface,
          })}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.m }}>
            <Text selectable style={[type.title, { color: colors.red, minWidth: 92 }]}>{n.number}</Text>
            <Text style={[type.body, { flexShrink: 1 }]}>{n.label}</Text>
          </View>
        </Pressable>
      ))}
      <P muted style={{ marginTop: space.m }}>Appen kontaktar ingen. Det är du som väljer vad du gör.</P>
    </Card>
  );
}
