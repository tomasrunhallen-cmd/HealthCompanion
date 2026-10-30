import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { firstStep } from '../../analysis/assess';
import { addDays, eveningDateKey, formatDateSv, formatDateSvTitle } from '../../analysis/dates';
import { silentDaysUntil } from '../../analysis/scoring';
import { RULES } from '../../analysis/rules';
import { logHeavyDay } from '../../services/checkin';
import { Button, Card, Dot, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, LEVEL_TEXT, levelColor, space, type } from '../theme';

export function HomeScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  const today = eveningDateKey(new Date());
  const entries = repo.entries();
  const todayEntry = repo.entryFor(today);
  const todayAssessment = todayEntry ? repo.assessmentFor(todayEntry.id) : null;
  const silent = silentDaysUntil(today, entries);
  const plan = repo.plan();
  const hasSigns = plan.some((p) => p.kind === 'early' || p.kind === 'serious');
  const firstYellow = firstStep('yellow', plan);

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const e = repo.entryFor(date);
    const a = e ? repo.assessmentFor(e.id) : null;
    return { date, level: a?.level ?? null };
  });

  const onHeavy = async () => {
    if (todayEntry) {
      const ok = await dialog.confirm({
        title: 'Ersätta kvällens avstämning?',
        message: 'Du har redan gjort en avstämning i kväll. Orkar bara trycka ersätter den.',
        confirmLabel: 'Ersätt',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { entry } = await logHeavyDay(repo);
      nav.push({ name: 'result', entryId: entry.id, fresh: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={[type.small, {}]}>{formatDateSvTitle(today)}</Text>
      <Text style={[type.title, { marginBottom: space.l }]}>Dagsljus</Text>

      {!hasSigns && (
        <Card tone="accent">
          <Text style={type.h2}>Börja med din krisplan</Text>
          <P style={{ marginTop: space.xs, marginBottom: space.m }}>
            Appen jämför bara med de tecken och åtgärder du själv har i din plan. Klistra in den så sorterar du raderna.
          </P>
          <Button title="Lägg in krisplan" onPress={() => nav.push({ name: 'planImport' })} />
        </Card>
      )}

      {silent >= RULES.silenceDays && (
        <Card tone="yellow" style={{ borderColor: colors.yellow }}>
          <Text style={[type.h2, { color: colors.text }]}>Gult: {silent} dagar utan inlägg</Text>
          <P style={{ marginTop: space.xs }}>
            Tystnaden räknas som ett tecken i nästa bedömning.
            {firstYellow ? ` Första steget i din plan: ${firstYellow.text}` : ''}
          </P>
        </Card>
      )}

      {todayAssessment ? (
        <Pressable onPress={() => nav.push({ name: 'result', entryId: todayEntry!.id })} accessibilityRole="button">
          <Card tone={todayAssessment.level}>
            <Row>
              <Dot level={todayAssessment.level} size={18} />
              <Text style={[type.h2, { color: levelColor(todayAssessment.level) }]}>
                I kväll: {LEVEL_TEXT[todayAssessment.level]}
              </Text>
            </Row>
            <P style={{ marginTop: space.s }}>{todayAssessment.sentence}</P>
            <Text style={[type.small, { marginTop: space.s, color: colors.accent, fontWeight: '600' }]}>Visa bedömningen ›</Text>
          </Card>
        </Pressable>
      ) : null}

      <Button
        big
        title={todayEntry ? 'Gör om kvällens avstämning' : 'Kvällens avstämning'}
        kind={todayEntry ? 'secondary' : 'primary'}
        onPress={() => nav.push({ name: 'checkin' })}
      />
      <Button big kind="secondary" title="Orkar bara trycka" busy={busy} onPress={onHeavy} />
      <P muted style={{ textAlign: 'center', marginTop: space.xs }}>Loggar dagen som tung, utan frågor.</P>

      <Section title="Senaste veckan" right={<Button kind="ghost" title="Alla dagar" onPress={() => nav.push({ name: 'history' })} />}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {week.map((d) => (
              <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
                <Dot level={d.level} size={22} />
                <Text style={type.small}>{formatDateSv(d.date).slice(0, 2)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title="Mer">
        <Button kind="secondary" title="Min krisplan" onPress={() => nav.push({ name: 'plan' })} />
        <Button kind="secondary" title="Inställningar" onPress={() => nav.push({ name: 'settings' })} />
        <Button kind="secondary" title="Data och integritet" onPress={() => nav.push({ name: 'privacy' })} />
      </Section>
    </Screen>
  );
}
