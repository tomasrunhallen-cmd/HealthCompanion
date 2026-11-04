// "Räkna om historiken med nya regler" (B3). Every day is computed again with the rules in
// rules/rules.json from what was saved with it, without asking any model again. The person
// sees which days would change before anything is saved.

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { formatDateSvTitleYear } from '../../core/analysis/dates';
import { outdatedDays, rereadDays, type RecomputedDay } from '../../core/analysis/recompute';
import { moodStep } from '../../core/analysis/mood';
import { RULES_VERSION } from '../../core/analysis/rules';
import { applyRecompute, previewRecompute } from '../../services/recompute';
import { Button, Card, Dot, P, Screen, Section } from '../components';
import { useDialog, useRepo } from '../state';
import { LEVEL_TEXT, space, type } from '../theme';

/** Why a day changes, when it is not the rules: its mood was read again from the diary. */
function why(d: RecomputedDay): string | null {
  return d.moodReread ? `Stämningen läses nu som ${moodStep(d.moodReread.to).label} (${d.moodReread.to}), var ${moodStep(d.moodReread.from).label} (${d.moodReread.from})` : null;
}

function DayRow({ d }: { d: RecomputedDay }) {
  const reason = why(d);
  return (
    <View
      accessible
      accessibilityLabel={`${formatDateSvTitleYear(d.date)}: ${LEVEL_TEXT[d.before.level]} blir ${LEVEL_TEXT[d.after.level]}${reason ? `. ${reason}` : ''}`}
      style={{ paddingVertical: space.s }}
    >
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Text style={[type.body, { flex: 1 }]}>{formatDateSvTitleYear(d.date)}</Text>
      <Dot level={d.before.level} />
      <Text style={type.small}>{LEVEL_TEXT[d.before.level]} {d.before.points} p</Text>
      <Text style={type.body}>→</Text>
      <Dot level={d.after.level} />
      <Text style={[type.small, { fontWeight: '700' }]}>{LEVEL_TEXT[d.after.level]} {d.after.points} p</Text>
    </View>
    {reason ? <Text style={type.small}>{reason.replace(/-/g, '−')}</Text> : null}
    </View>
  );
}

export function RecomputeScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const [days, setDays] = useState<RecomputedDay[] | null>(null);
  const outdated = useMemo(() => outdatedDays(repo.assessments()), [repo, repo.revision]);
  const reread = useMemo(() => rereadDays(repo.entries(), repo.assessments()), [repo, repo.revision]);
  const changed = days?.filter((d) => d.changed) ?? [];
  const approximate = days?.filter((d) => d.approximate).length ?? 0;

  return (
    <Screen
      title="Räkna om"
      footer={
        days && !changed.length && !outdated && !reread ? (
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
      {reread ? (
        <P style={{ marginTop: space.s }}>
          {reread === 1 ? 'En importerad dag' : `${reread} importerade dagar`} har fått stämningen omläst ur dagboken: dagbokens Depression är nu −2, inte −3.
          Nivån ändras först när du sparar här.
        </P>
      ) : null}
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
