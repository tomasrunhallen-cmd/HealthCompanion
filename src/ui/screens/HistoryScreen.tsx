import React from 'react';
import { displaySentence } from '../../analysis/assess';
import { Pressable, Text, View } from 'react-native';
import { formatDateSvTitle } from '../../analysis/dates';
import { Card, Dot, P, Screen } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, LEVEL_TEXT, space, type } from '../theme';

export function HistoryScreen() {
  const repo = useRepo();
  const nav = useNav();
  const entries = [...repo.entries()].reverse();
  return (
    <Screen title="Alla dagar" back>
      {entries.length === 0 ? <P muted>Inga inlägg ännu.</P> : null}
      {entries.map((e) => {
        const a = repo.assessmentFor(e.id);
        return (
          <Pressable key={e.id} onPress={() => nav.push({ name: 'result', entryId: e.id })} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Dot level={a?.level ?? null} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: '700' }]}>{formatDateSvTitle(e.date)}</Text>
                  <Text style={type.small} numberOfLines={2}>
                    {a ? `${LEVEL_TEXT[a.level]} · ` : ''}
                    {e.kind === 'heavy' ? 'Orkar bara trycka' : a ? displaySentence(a) : ''}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 20 }}>›</Text>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
