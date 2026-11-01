import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { firstStep } from '../../analysis/assess';
import { addDays, eveningDateKey, formatDateSv, formatDateSvTitle } from '../../analysis/dates';
import { silentDaysUntil } from '../../analysis/scoring';
import { RULES } from '../../analysis/rules';
import { logHeavyDay } from '../../services/checkin';
import { standardNudgeWeek, startWithStandard, unconfirmedStandard } from '../../context/standard';
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
  const settings = repo.settings();
  const nudgeWeek = standardNudgeWeek(settings, unconfirmedStandard(repo).length);

  const chooseStandard = async () => {
    const ok = await dialog.confirm({
      title: 'Börja med standard?',
      message:
        'Appen lägger in allmänna tecken och åtgärder som ofta står i krisplaner. De kan bara ge gult, aldrig rött, ' +
        'tills du bekräftat eller ersatt dem med din egen plan. Du kan ändra och ta bort allt under Min krisplan.',
      confirmLabel: 'Börja med standard',
    });
    if (ok) await startWithStandard(repo);
  };

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
          <Text style={type.h2}>Hur vill du börja?</Text>
          <P style={{ marginTop: space.xs, marginBottom: space.m }}>
            Appen jämför din anteckning med tecknen i din krisplan. Har du ingen plan till hands kan du börja med
            allmänna tecken och byta till din egen senare.
          </P>
          <Button title="Ladda in min krisplan" onPress={() => nav.push({ name: 'planImport' })} />
          <Button kind="secondary" title="Börja med standard" onPress={chooseStandard} />
        </Card>
      )}

      {repo.pendingSuggestions().length > 0 && (
        <Pressable onPress={() => nav.push({ name: 'suggestions' })} accessibilityRole="button">
          <Card tone="accent">
            <Text style={type.h2}>{repo.pendingSuggestions().length === 1 ? 'Ett förslag väntar' : `${repo.pendingSuggestions().length} förslag väntar`}</Text>
            <P style={{ marginTop: space.xs }}>Appen ändrar inget om dig förrän du godkänt det.</P>
            <Text style={[type.small, { marginTop: space.s, color: colors.accent, fontWeight: '600' }]}>Granska ›</Text>
          </Card>
        </Pressable>
      )}

      {nudgeWeek != null && (
        <Card tone="accent">
          <Text style={type.h2}>Din plan bygger på standardinnehåll</Text>
          <P style={{ marginTop: space.xs, marginBottom: space.m }}>
            Standardtecken kan bara ge gult. Lägg in din egen krisplan när du kan, eller bekräfta de rader som stämmer för
            dig under Min krisplan.
          </P>
          <Button title="Ladda in min krisplan" onPress={() => nav.push({ name: 'planImport' })} />
          <Button kind="ghost" title="Påminn mig nästa vecka" onPress={() => repo.updateSettings({ standardNudgeDismissedWeek: nudgeWeek })} />
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
        <Button kind="secondary" title="Det appen vet om mig" onPress={() => nav.push({ name: 'knowledge' })} />
        <Button kind="secondary" title="Inställningar" onPress={() => nav.push({ name: 'settings' })} />
        <Button kind="secondary" title="Data och integritet" onPress={() => nav.push({ name: 'privacy' })} />
      </Section>
    </Screen>
  );
}
