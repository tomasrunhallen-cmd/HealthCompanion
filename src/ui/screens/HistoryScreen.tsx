import React, { useMemo, useState } from 'react';
import { displaySentence } from '../../core/analysis/assess';
import { Pressable, Text, View } from 'react-native';
import { formatDateSvTitleYear } from '../../core/analysis/dates';
import { Button, Card, Dot, P, Screen } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, LEVEL_TEXT, space, type } from '../theme';

/** Days shown at a time; imports can bring years of days. */
const PAGE = 60;

export function HistoryScreen() {
  const repo = useRepo();
  const nav = useNav();
  const [shown, setShown] = useState(PAGE);
  const entries = useMemo(() => [...repo.entries()].reverse(), [repo, repo.revision]);
  const byEntry = useMemo(() => repo.assessmentsByEntry(), [repo, repo.revision]);
  return (
    <Screen title="Alla dagar" back>
      {entries.length === 0 ? <P muted>Inga inlägg ännu.</P> : null}
      {entries.length ? <Button kind="ghost" title="Räkna om historiken med nya regler" onPress={() => nav.push({ name: 'recompute' })} /> : null}
      {entries.slice(0, shown).map((e) => {
        const a = byEntry.get(e.id) ?? null;
        return (
          <Pressable key={e.id} onPress={() => nav.push({ name: 'result', entryId: e.id })} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Dot level={a?.level ?? null} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: '700' }]}>{formatDateSvTitleYear(e.date)}</Text>
                  <Text style={type.small} numberOfLines={2}>
                    {a ? `${LEVEL_TEXT[a.level]} · ` : ''}
                    {e.kind === 'heavy' ? 'Orkar bara trycka' : a ? displaySentence(a) : ''}
                    {e.kind === 'imported' ? ' · Importerad' : ''}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 20 }}>›</Text>
              </View>
            </Card>
          </Pressable>
        );
      })}
      {entries.length > shown ? (
        <Button kind="secondary" title={`Visa ${Math.min(PAGE, entries.length - shown)} till (${entries.length - shown} kvar)`} onPress={() => setShown(shown + PAGE)} />
      ) : null}
    </Screen>
  );
}
