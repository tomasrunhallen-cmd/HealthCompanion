import React, { useState } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { displaySentence, firstStep } from '../../core/analysis/assess';
import { addDays, eveningDateKey, formatDateSv, formatDateSvTitle } from '../../core/analysis/dates';
import { silentDaysUntil } from '../../core/analysis/scoring';
import { RULES } from '../../core/analysis/rules';
import { logHeavyDay } from '../../services/checkin';
import { standardNudgeWeek } from '../../core/context/standard';
import { startWithStandard, unconfirmedStandard } from '../../services/standard';
import { dueNow, runProfileReview } from '../../services/profile';
import { Button, Card, Dot, P, Row, Screen, Section } from '../components';
import { homeQueue, laterToday, putAside, type HomeCard, type HomeLater } from '../../core/analysis/homeCards';
import type { Level } from '../../core/domain/types';
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

const HOME_LATER_KEY = 'homeLater';

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
      title: 'Börja med allmänna tecken?',
      message:
        'Appen lägger in allmänna tecken och åtgärder som ofta står i krisplaner. De kan bara ge gult, aldrig rött, ' +
        'tills du bekräftat eller ersatt dem med din egen plan. Du kan ändra och ta bort allt under Min krisplan.',
      confirmLabel: 'Börja',
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

  // One card at a time, highest priority first (core/analysis/homeCards.ts).
  const pending = showSuggestions ? repo.pendingSuggestions().length : 0;
  const candidates: HomeCard[] = [
    silent >= RULES.silenceDays ? { kind: 'silence' as const, id: `silence_${silent}` } : null,
    !hasSigns ? { kind: 'start' as const, id: 'start' } : null,
    ...tomorrow.map((t) => ({ kind: 'tomorrow' as const, id: `tomorrow_${t.date}_${t.event}` })),
    sleepNote ? { kind: 'sleepNotice' as const, id: 'sleepNotice' } : null,
    fw?.weekPicture ? { kind: 'weekPicture' as const, id: 'weekPicture' } : null,
    fw?.offerSleepSource ? { kind: 'sleepSource' as const, id: 'sleepSource' } : null,
    pending ? { kind: 'suggestions' as const, id: 'suggestions' } : null,
    showSuggestions && due ? { kind: 'review' as const, id: `review_${due.reason}` } : null,
    nudgeWeek != null ? { kind: 'standardNudge' as const, id: 'standardNudge' } : null,
    repo.contextOf('routine').length ? { kind: 'routines' as const, id: 'routines' } : null,
  ].filter((c): c is HomeCard => c != null);
  const queue = homeQueue(candidates, laterToday(repo.kvGet(HOME_LATER_KEY) as HomeLater | null, today));
  const card = queue[0] ?? null;
  const later = (id: string) => repo.kvSet(HOME_LATER_KEY, putAside(repo.kvGet(HOME_LATER_KEY) as HomeLater | null, today, id));
  const notNow = (id: string) => (
    <Button kind="ghost" title="Inte nu" hint="Kortet visas igen i morgon" onPress={() => later(id)} />
  );

  const renderCard = (c: HomeCard) => {
    switch (c.kind) {
      case 'silence':
        return (
          <Card tone="yellow" style={{ borderColor: colors.yellow }}>
            <Row>
              <Dot level="yellow" size={20} />
              <Text style={[type.h2, { color: colors.text, flexShrink: 1 }]} accessibilityRole="header">{silent} dagar utan avstämning</Text>
            </Row>
            <P style={{ marginTop: space.xs }}>
              Det räknas som ett tidigt tecken i nästa bedömning.
              {firstYellow ? ` Första steget i din plan: ${firstYellow.text}` : ''}
            </P>
            {notNow(c.id)}
          </Card>
        );
      case 'start':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">Lägg in din krisplan</Text>
            <P style={{ marginTop: space.xs, marginBottom: space.m }}>
              Appen jämför din anteckning med tecknen i din krisplan. Har du ingen plan till hands kan du börja med allmänna
              tecken och byta till din egen senare.
            </P>
            <Button title="Lägg in min krisplan" onPress={() => nav.push({ name: 'planImport' })} />
            <Button kind="secondary" title="Börja med allmänna tecken" onPress={chooseStandard} />
            {notNow(c.id)}
          </Card>
        );
      case 'tomorrow': {
        const t = tomorrow.find((x) => `tomorrow_${x.date}_${x.event}` === c.id)!;
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">I morgon: {t.event}</Text>
            {t.trigger ? <P style={{ marginTop: space.xs }}>Din plan nämner det som en risksituation: ”{t.trigger}”.</P> : null}
            {t.routines.length ? (
              <>
                <P style={{ marginTop: space.xs }}>Din plan:</P>
                {t.routines.map((r) => <P key={r}>{`• ${r}`}</P>)}
              </>
            ) : null}
            {notNow(c.id)}
          </Card>
        );
      }
      case 'sleepNotice':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">{sleepNote!.title}</Text>
            <P style={{ marginTop: space.xs }}>{sleepNote!.body}</P>
            <P muted style={{ marginTop: space.xs }}>En påminnelse om din egen plan. Den påverkar inte nivån.</P>
            <Button kind="ghost" title="Okej" onPress={() => repo.kvSet(NOTICE_KEY, { ...sleepNote, dismissed: true })} />
          </Card>
        );
      case 'weekPicture':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">Din första vecka</Text>
            <WeekRow week={week} fontScale={fontScale} />
            <P style={{ marginTop: space.s }}>{GREEN_MEANS}</P>
            <P muted style={{ marginTop: space.xs }}>Gult betyder att ett eller flera av dina tecken syntes. Rött betyder att flera syntes, eller ett allvarligt tillsammans med ett annat.</P>
            <Button kind="ghost" title="Okej" onPress={() => markFirstWeek(repo, 'weekPicture')} />
          </Card>
        );
      case 'sleepSource':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">Sömnen gör bedömningen bättre</Text>
            <P style={{ marginTop: space.xs }}>Koppla din Garmin, eller ange sömnen själv i kvällens avstämning. Du väljer.</P>
            <Button title="Koppla Garmin" onPress={() => nav.push({ name: 'garmin' })} />
            <Button kind="ghost" title="Jag anger sömnen själv" onPress={() => markFirstWeek(repo, 'sleepSource')} />
          </Card>
        );
      case 'suggestions':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">{pending === 1 ? 'Ett förslag väntar' : `${pending} förslag väntar`}</Text>
            <P style={{ marginTop: space.xs }}>Appen ändrar inget om dig förrän du godkänt det.</P>
            <Button title="Granska" onPress={() => nav.push({ name: 'suggestions' })} />
            {notNow(c.id)}
          </Card>
        );
      case 'review':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">Dags att se över din profil</Text>
            <P style={{ marginTop: space.xs, marginBottom: space.m }}>
              {due!.reason === 'period'
                ? 'En period med gult eller rött i mer än tre dagar är över. Appen kan föreslå vad som kan läggas till i din profil.'
                : 'En månad har gått. Appen kan föreslå ändringar i din profil utifrån dina anteckningar.'}{' '}
              Du godkänner varje förslag själv.
            </P>
            <Button title="Gå igenom" onPress={review} busy={reviewing} />
            {notNow(c.id)}
          </Card>
        );
      case 'standardNudge':
        return (
          <Card tone="accent">
            <Text style={type.h2} accessibilityRole="header">Din plan bygger på allmänna tecken</Text>
            <P style={{ marginTop: space.xs, marginBottom: space.m }}>
              Allmänna tecken kan bara ge gult. Lägg in din egen krisplan när du kan, eller bekräfta de rader som stämmer för dig
              under Min krisplan.
            </P>
            <Button title="Lägg in min krisplan" onPress={() => nav.push({ name: 'planImport' })} />
            <Button kind="ghost" title="Påminn mig nästa vecka" onPress={() => repo.updateSettings({ standardNudgeDismissedWeek: nudgeWeek! })} />
          </Card>
        );
      case 'routines':
        return <RoutinesToday />;
    }
  };

  return (
    <Screen title="Dagsljus">
      <Text style={[type.small, { marginBottom: space.l }]}>{formatDateSvTitle(today)}</Text>

      {todayAssessment ? (
        <Pressable
          onPress={() => nav.push({ name: 'result', entryId: todayEntry!.id })}
          accessibilityRole="button"
          accessibilityLabel={`I kväll: ${LEVEL_TEXT[todayAssessment.level]}. ${displaySentence(todayAssessment)}`}
          accessibilityHint="Visar bedömningen"
        >
          <Card tone={todayAssessment.level}>
            <Row>
              <Dot level={todayAssessment.level} size={20} />
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

      {card ? (
        <View style={{ marginTop: space.xl }}>
          {renderCard(card)}
          {queue.length > 1 ? (
            <Text style={[type.small, { textAlign: 'center' }]}>
              {queue.length === 2 ? 'En sak till väntar.' : `${queue.length - 1} saker till väntar.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Section title="Senaste veckan" right={<Button kind="ghost" title="Alla dagar" onPress={() => nav.push({ name: 'history' })} />}>
        <Card>
          <WeekRow week={week} fontScale={fontScale} />
        </Card>
      </Section>

      <Button kind="ghost" title="Lågt läge: bara avstämningen" hint="Döljer allt utom avstämningen och Hjälp nu" onPress={() => repo.updateSettings({ lowMode: true })} />
    </Screen>
  );
}

/** Seven days with their level. HIG: fewer columns at large text sizes, so nothing is cut off. */
function WeekRow({ week, fontScale }: { week: { date: string; level: Level | null }[]; fontScale: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: fontScale > 1.4 ? 'flex-start' : 'space-between', rowGap: space.m, columnGap: space.m, marginTop: space.s }}>
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
  );
}
