import React, { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { displaySentence, firstStep } from '../../core/analysis/assess';
import { addDays, eveningDateKey, formatDateSv, formatDateSvTitle } from '../../core/analysis/dates';
import { silentDaysUntil } from '../../core/analysis/scoring';
import { RULES } from '../../core/analysis/rules';
import { logHeavyDay } from '../../services/checkin';
import { standardNudgeWeek } from '../../core/context/standard';
import { startWithStandard, unconfirmedStandard } from '../../services/standard';
import { dueNow, runProfileReview } from '../../services/profile';
import { Platform } from 'react-native';
import { Button, Card, Dot, P, Row, Screen, Section } from '../components';
import { MEDICAL_REMINDER } from '../../legal';
import { useNav } from '../nav';
import { RoutinesToday } from '../RoutinesToday';
import { suggestionsOnHome } from '../../core/analysis/signals';
import { greenDayLine } from '../../core/plan/routines';
import { adviceForTomorrow } from '../../core/analysis/events';
import { GREEN_MEANS } from '../../core/analysis/firstWeek';
import { firstWeekState, markFirstWeek } from '../../services/firstWeek';
import { NOTICE_KEY, todaysSleepNotice } from '../../services/sleepNotice';
import { useDialog, useRepo } from '../state';
import { colors, LEVEL_TEXT, levelColor, space, type } from '../theme';

export function HomeScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const { fontScale } = useWindowDimensions();
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
  const due = dueNow(repo);
  const sleepNote = todaysSleepNotice(repo);
  const fw = firstWeekState(repo);
  const tomorrow = adviceForTomorrow(repo.contextEntries(), today);
  const greenLine = greenDayLine(repo.contextEntries(), today, { measured: repo.measuredDays(), window: repo.planSettings().sleepWindow ?? null });
  const showSuggestions = suggestionsOnHome(settings.suggestionPace, today);
  const [reviewing, setReviewing] = useState(false);

  const review = async () => {
    if (!due) return;
    setReviewing(true);
    try {
      const res = await runProfileReview(repo, due, { browser: Platform.OS === 'web' });
      if (res.error) await dialog.info('Genomgången blev inte klar', `${res.error} Försök igen senare.`);
      else if (res.made) nav.push({ name: 'suggestions' });
      else await dialog.info('Inga förslag', res.usedModel ? 'Inget i anteckningarna behöver ändras i din profil.' : 'Inget att föreslå. Med en språkmodell kopplad kan appen också föreslå ändringar i profilen.');
    } finally {
      setReviewing(false);
    }
  };

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

  // Första veckan, day 1: only the check-in, so the start is calm.
  if (fw?.onlyCheckin && !settings.lowMode) {
    return (
      <Screen title="Dagsljus">
        <Text style={[type.small, { marginBottom: space.l }]}>{formatDateSvTitle(today)}</Text>
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">Välkommen</Text>
          <P style={{ marginTop: space.xs }}>
            I dag gör du bara kvällens avstämning: några meningar om dagen och två reglage. Resten kommer under veckan.
          </P>
          <P muted style={{ marginTop: space.s }}>{MEDICAL_REMINDER}</P>
        </Card>
        <Button big title={todayEntry ? 'Gör om kvällens avstämning' : 'Kvällens avstämning'} onPress={() => nav.push({ name: 'checkin' })} />
        {!hasSigns ? <Button kind="ghost" title="Lägg in din krisplan när du vill" onPress={() => nav.push({ name: 'plan' })} /> : null}
      </Screen>
    );
  }

  // Lågt läge: only the check-in and Hjälp nu (in the top bar). Everything else waits.
  if (settings.lowMode) {
    return (
      <Screen title="Dagsljus">
        <Text style={[type.small, { marginBottom: space.l }]}>{formatDateSvTitle(today)}</Text>
        <Button big title={todayEntry ? 'Gör om kvällens avstämning' : 'Kvällens avstämning'} onPress={() => nav.push({ name: 'checkin' })} />
        <Button big kind="secondary" title="Orkar bara trycka" busy={busy} onPress={onHeavy} />
        <P muted style={{ textAlign: 'center', marginTop: space.l }}>Lågt läge: bara avstämningen och Hjälp nu visas.</P>
        <Button kind="ghost" title="Lämna lågt läge" onPress={() => repo.updateSettings({ lowMode: false })} />
      </Screen>
    );
  }

  return (
    <Screen title="Dagsljus">
      <Text style={[type.small, { marginBottom: space.l }]}>{formatDateSvTitle(today)}</Text>

      {!hasSigns && (
        <Card tone="accent">
          <Text style={type.h2}>Hur vill du börja?</Text>
          <P style={{ marginTop: space.xs, marginBottom: space.m }}>
            Appen jämför din anteckning med tecknen i din krisplan. Har du ingen plan till hands kan du börja med
            allmänna tecken och byta till din egen senare.
          </P>
          <P muted style={{ marginBottom: space.m }}>{MEDICAL_REMINDER}</P>
          <Button title="Ladda in min krisplan" onPress={() => nav.push({ name: 'planImport' })} />
          <Button kind="secondary" title="Börja med standard" onPress={chooseStandard} />
        </Card>
      )}

      {showSuggestions && repo.pendingSuggestions().length > 0 && (
        <Pressable onPress={() => nav.push({ name: 'suggestions' })} accessibilityRole="button">
          <Card tone="accent">
            <Text style={type.h2}>{repo.pendingSuggestions().length === 1 ? 'Ett förslag väntar' : `${repo.pendingSuggestions().length} förslag väntar`}</Text>
            <P style={{ marginTop: space.xs }}>Appen ändrar inget om dig förrän du godkänt det.</P>
            <Text style={[type.small, { marginTop: space.s, color: colors.accent, fontWeight: '600' }]}>Granska ›</Text>
          </Card>
        </Pressable>
      )}

      {showSuggestions && due && (
        <Card tone="accent">
          <Text style={type.h2}>Dags att se över din profil</Text>
          <P style={{ marginTop: space.xs, marginBottom: space.m }}>
            {due.reason === 'period'
              ? 'En period med gult eller rött i mer än tre dagar är över. Appen kan föreslå hur perioden utvecklades och vad som kan läggas till i din profil.'
              : 'En månad har gått. Appen kan föreslå ändringar i din profil utifrån dina anteckningar.'}{' '}
            Du godkänner varje förslag själv.
          </P>
          <Button title="Gå igenom" onPress={review} busy={reviewing} />
        </Card>
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

      {fw?.weekPicture ? (
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">Din första vecka</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.s }}>
            {week.map((d) => (
              <View key={d.date} accessible accessibilityLabel={`${formatDateSv(d.date)}: ${d.level ? LEVEL_TEXT[d.level] : 'ingen avstämning'}`} style={{ alignItems: 'center', gap: 4 }}>
                <Dot level={d.level} size={22} />
                <Text style={type.small}>{formatDateSv(d.date).slice(0, 2)}</Text>
              </View>
            ))}
          </View>
          <P style={{ marginTop: space.s }}>{GREEN_MEANS}</P>
          <P muted style={{ marginTop: space.xs }}>Gult betyder att ett eller flera av dina tecken syntes. Rött betyder att flera syntes, eller ett allvarligt tillsammans med ett annat.</P>
          <Button kind="ghost" title="Okej" onPress={() => markFirstWeek(repo, 'weekPicture')} />
        </Card>
      ) : null}

      {fw?.offerSleepSource ? (
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">Sömnen gör bedömningen bättre</Text>
          <P style={{ marginTop: space.xs }}>Koppla din Garmin, eller ange sömnen själv i kvällens avstämning. Du väljer.</P>
          <Button title="Koppla Garmin" onPress={() => nav.push({ name: 'garmin' })} />
          <Button kind="ghost" title="Jag anger sömnen själv" onPress={() => markFirstWeek(repo, 'sleepSource')} />
        </Card>
      ) : null}

      {tomorrow.map((t) => (
        <Card key={t.event + t.date} tone="accent">
          <Text style={type.h2} accessibilityRole="header">I morgon: {t.event}</Text>
          {t.trigger ? <P style={{ marginTop: space.xs }}>Din plan nämner det som en risksituation: ”{t.trigger}”.</P> : null}
          {t.routines.length ? (
            <>
              <P style={{ marginTop: space.xs }}>Din plan:</P>
              {t.routines.map((r) => <P key={r}>{`• ${r}`}</P>)}
            </>
          ) : null}
        </Card>
      ))}

      {sleepNote ? (
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">{sleepNote.title}</Text>
          <P style={{ marginTop: space.xs }}>{sleepNote.body}</P>
          <P muted style={{ marginTop: space.xs }}>Det här ger inga poäng. Det är bara en påminnelse om din egen plan.</P>
          <Button kind="ghost" title="Okej" onPress={() => repo.kvSet(NOTICE_KEY, { ...sleepNote, dismissed: true })} />
        </Card>
      ) : null}

      {todayAssessment ? (
        <Pressable onPress={() => nav.push({ name: 'result', entryId: todayEntry!.id })} accessibilityRole="button">
          <Card tone={todayAssessment.level}>
            <Row>
              <Dot level={todayAssessment.level} size={18} />
              <Text style={[type.h2, { color: levelColor(todayAssessment.level) }]}>
                I kväll: {LEVEL_TEXT[todayAssessment.level]}
              </Text>
            </Row>
            <P style={{ marginTop: space.s }}>{displaySentence(todayAssessment)}</P>
            {todayAssessment.level === 'green' && greenLine ? <P muted style={{ marginTop: space.xs }}>{greenLine}</P> : null}
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

      <View style={{ marginTop: space.xl }}>
        <RoutinesToday />
      </View>

      <Section title="Senaste veckan" right={<Button kind="ghost" title="Alla dagar" onPress={() => nav.push({ name: 'history' })} />}>
        <Card>
          {/* HIG: fewer columns at large text sizes, so nothing is cut off. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: fontScale > 1.4 ? 'flex-start' : 'space-between', rowGap: space.m, columnGap: space.m }}>
            {week.map((d) => (
              <View
                key={d.date}
                style={{ alignItems: 'center', gap: 6, minWidth: 36 }}
                accessible
                accessibilityLabel={`${formatDateSv(d.date)}: ${d.level ? LEVEL_TEXT[d.level] : 'ingen avstämning'}`}
              >
                <Dot level={d.level} size={22} />
                <Text style={type.small}>{formatDateSv(d.date).slice(0, 2)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Button kind="ghost" title="Lågt läge: bara avstämningen" onPress={() => repo.updateSettings({ lowMode: true })} />
    </Screen>
  );
}
