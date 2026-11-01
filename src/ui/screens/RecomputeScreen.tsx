// "Räkna om historiken med nya regler" (B3). Every day is computed again with the rules in
// rules/rules.json from what was saved with it, without asking any model again. The person
// sees which days would change before anything is saved.

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { formatDateSvTitleYear } from '../../core/analysis/dates';
import { outdatedDays, type RecomputedDay } from '../../core/analysis/recompute';
import { RULES_VERSION } from '../../core/analysis/rules';
import { applyRecompute, previewRecompute } from '../../services/recompute';
import { Button, Card, Dot, P, Screen, Section } from '../components';
import { useDialog, useRepo } from '../state';
import { LEVEL_TEXT, space, type } from '../theme';

function DayRow({ d }: { d: RecomputedDay }) {
  return (
    <View
      accessible
      accessibilityLabel={`${formatDateSvTitleYear(d.date)}: ${LEVEL_TEXT[d.before.level]} blir ${LEVEL_TEXT[d.after.level]}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s }}
    >
      <Text style={[type.body, { flex: 1 }]}>{formatDateSvTitleYear(d.date)}</Text>
      <Dot level={d.before.level} />
      <Text style={type.small}>{LEVEL_TEXT[d.before.level]} {d.before.points} p</Text>
      <Text style={type.body}>→</Text>
      <Dot level={d.after.level} />
      <Text style={[type.small, { fontWeight: '700' }]}>{LEVEL_TEXT[d.after.level]} {d.after.points} p</Text>
    </View>
  );
}

export function RecomputeScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const [days, setDays] = useState<RecomputedDay[] | null>(null);
  const outdated = useMemo(() => outdatedDays(repo.assessments()), [repo, repo.revision]);
  const changed = days?.filter((d) => d.changed) ?? [];
  const approximate = days?.filter((d) => d.approximate).length ?? 0;

  return (
    <Screen
      title="Räkna om"
      footer={
        days && !changed.length && !outdated ? (
          <Button big title="Klar" onPress={() => setDays(null)} />
        ) : days ? (
          <>
            <Button big title={changed.length ? `Spara de nya nivåerna (${changed.length === 1 ? 'en dag ändras' : `${changed.length} dagar ändras`})` : 'Spara regelversionen'} onPress={async () => {
              const n = await applyRecompute(repo, days);
              setDays(null);
              await dialog.info('Sparat', n ? `${n} dagar fick en ny nivå. Den tidigare nivån finns kvar i varje bedömning.` : 'Inga nivåer ändrades. Alla dagar är nu räknade med reglerna ' + RULES_VERSION + '.');
            }} />
            <Button kind="ghost" title="Avbryt, spara inget" onPress={() => setDays(null)} />
          </>
        ) : (
          <Button big title="Visa skillnaden" disabled={!repo.assessments().length} onPress={() => setDays(previewRecompute(repo))} />
        )
      }
    >
      <P muted>
        Appen räknar om varje dag med reglerna i version {RULES_VERSION}, utifrån det som sparades med dagen: tecknen som hittades,
        mätvärdena och svaren på medicinfrågan. Ingen språkmodell tillfrågas igen. Du ser vilka dagar som skulle få en annan nivå
        innan något sparas.
      </P>
      <P muted style={{ marginTop: space.s }}>
        {outdated ? `${outdated} dagar är räknade med äldre regler eller saknar regelversion.` : 'Alla dagar är räknade med de nuvarande reglerna.'}
      </P>
      {days ? (
        <>
          <Section title={changed.length ? (changed.length === 1 ? 'En dag ändras' : `${changed.length} dagar ändras`) : 'Inga dagar ändras'}>
            <Card>
              {changed.length ? changed.map((d) => <DayRow key={d.entryId} d={d} />) : <P>{days.length === 1 ? 'Dagen får samma nivå och poäng.' : `Alla ${days.length} dagar får samma nivå och poäng.`}</P>}
            </Card>
          </Section>
          {approximate ? (
            <P muted>
              {approximate} dagar sparades innan appen sparade all indata. För dem används dagens krisplan och värden, så resultatet kan
              skilja sig lite från vad reglerna gav då.
            </P>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
