import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, eveningDateKey, formatDateSv } from '../../core/analysis/dates';
import {
  bucketTrend, buildTrend, GRAIN_TEXT, PERIOD_DAYS, PERIOD_GRAIN, PERIOD_LABEL, PERIODS,
  type Grain, type TrendBucket, type TrendDay, type TrendPeriod,
} from '../../core/analysis/trend';
import { MOOD_MAX, moodStep, moodText } from '../../core/analysis/mood';
import { RULES } from '../../core/analysis/rules';
import { routineStats, trackedRoutines } from '../../core/plan/routines';
import { Button, Card, Dot, P, Screen, Section, Segmented } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, LEVEL_TEXT, levelColor, MIN_TOUCH, radius, space, type } from '../theme';

const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',').replace('-', '−');
const withUnit = (n: number, unit: string) => (unit === '%' ? `${Math.round(n)} %` : unit ? `${dec(n)} ${unit}` : dec(n));
const CHART_HEIGHT = 120;
const MOOD_HALF = 66;
const AXIS_W = 22;
const PERIOD_KEY = 'trendPeriod';
const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** One bar's worth: a day, a week or a month, with what a tap on it reads out. */
interface Point {
  key: string;
  /** Under the chart, first and last: "3 nov", "v. 45", "nov". */
  short: string;
  /** Read out on a tap: "tisdag 3 november", "vecka 45, 2–8 nov", "november 2026". */
  name: string;
  value: number | null;
  /** Mood over a week or month: the lowest and highest rating. */
  min?: number | null;
  max?: number | null;
}

function bucketName(b: TrendBucket, grain: Grain): string {
  if (grain === 'day') return formatDateSv(b.from);
  if (grain === 'week') return `${b.label.replace('v.', 'vecka')}, ${Number(b.from.slice(8))}/${Number(b.from.slice(5, 7))}–${Number(b.to.slice(8))}/${Number(b.to.slice(5, 7))}`;
  return `${MONTH_NAMES[Number(b.from.slice(5, 7)) - 1]} ${b.from.slice(0, 4)}`;
}

/** The first and last bar's names under a chart, so the time axis reads without a grid. */
function Axis({ points }: { points: Point[] }) {
  if (!points.length) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[type.small, { fontSize: 12 }]}>{points[0].short}</Text>
      <Text style={[type.small, { fontSize: 12 }]}>{points[points.length - 1].short}</Text>
    </View>
  );
}

/**
 * One measure per chart (never two scales on one axis). Bars anchored to the baseline, one
 * hue, a 2-point gap between bars, a recessive reference line. Tapping a bar reads out its
 * day, week or month; VoiceOver gets a summary, and the same numbers are in the list.
 */
function BarChart(props: {
  title?: string;
  points: Point[];
  unit: string;
  /** Mean of a week or month rather than a day's value. */
  averaged: boolean;
  max?: number;
  reference?: { value: number; label: string };
}) {
  const [picked, setPicked] = useState<Point | null>(null);
  const values = props.points.map((p) => p.value).filter((v): v is number => v != null);
  const max = props.max ?? Math.max(1, ...values, props.reference?.value ?? 0) * 1.1;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const label = props.title ?? 'Diagram';
  const summary = values.length
    ? `${label}: ${values.length} av ${props.points.length} staplar har värden, i snitt ${withUnit(avg!, props.unit)}.`
    : `${label}: inga värden för perioden.`;
  return (
    <Card>
      {props.title ? <Text style={type.h2} accessibilityRole="header">{props.title}</Text> : null}
      <Text style={[type.small, { marginBottom: space.s }]} accessibilityLiveRegion="polite">
        {picked
          ? `${picked.name}: ${picked.value != null ? `${props.averaged ? 'snitt ' : ''}${withUnit(picked.value, props.unit)}` : 'inget värde'}`
          : avg != null ? `Snitt ${withUnit(avg, props.unit)}. Tryck på en stapel för detaljer.` : 'Inga värden för perioden.'}
      </Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {props.points.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPicked(picked?.key === p.key ? null : p)}
            importantForAccessibility="no"
            accessibilityElementsHidden
            style={{ flex: 1, height: CHART_HEIGHT, justifyContent: 'flex-end' }}
          >
            {p.value != null ? (
              <View style={{ height: Math.max(2, (Math.min(p.value, max) / max) * CHART_HEIGHT), backgroundColor: picked?.key === p.key ? colors.text : colors.accent, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
            ) : null}
          </Pressable>
        ))}
        {props.reference ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: (props.reference.value / max) * CHART_HEIGHT, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.text }}
          />
        ) : null}
      </View>
      <Axis points={props.points} />
      {props.reference ? <Text style={[type.small, { marginTop: space.xs }]}>{props.reference.label}</Text> : null}
    </Card>
  );
}

/** Where a mood value sits in the chart, from the top. */
const moodY = (v: number) => MOOD_HALF - (v / MOOD_MAX) * MOOD_HALF;
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

/**
 * Stämning from −3 to +3, read against a scale at the side, with faint lines at ±2 where a
 * rating starts to count. Days: a bar from the middle line, up towards mania and down towards
 * depression. Weeks and months: the swing from the lowest to the highest rating, with a dot
 * for the mean, since a mean alone hides the swings that matter in bipolar illness.
 */
function MoodChart(props: { points: Point[]; averaged: boolean; grain: Grain }) {
  const [picked, setPicked] = useState<Point | null>(null);
  const rated = props.points.filter((p) => p.value != null);
  const up = rated.filter((p) => (p.max ?? p.value!) >= 2).length;
  const down = rated.filter((p) => (p.min ?? p.value!) <= -2).length;
  const unit = props.grain === 'day' ? 'dagar' : props.grain === 'week' ? 'veckor' : 'månader';
  const summary = rated.length
    ? `Stämning: ${rated.length} ${unit} med skattning, ${down} med depression eller lägre, ${up} med uppvarvning eller högre.`
    : 'Stämning: inga skattningar för perioden.';
  const readout = (p: Point) => {
    if (p.value == null) return `${p.name}: ingen skattning`;
    if (!props.averaged) return `${p.name}: ${moodText(p.value)}`;
    const range = p.min != null && p.max != null && p.min !== p.max
      ? `från ${moodStep(p.min).label.toLowerCase()} (${signed(p.min)}) till ${moodStep(p.max).label.toLowerCase()} (${signed(p.max)})`
      : `${moodStep(p.value).label.toLowerCase()} (${signed(Math.round(p.value))}) hela ${props.grain === 'week' ? 'veckan' : 'månaden'}`;
    return `${p.name}: ${range}, snitt ${dec(p.value)}`;
  };
  return (
    <Card>
      <Text style={[type.small, { marginBottom: space.s }]} accessibilityLiveRegion="polite">
        {picked ? readout(picked) : !rated.length ? 'Inga skattningar för perioden.'
          : props.averaged ? `Varje stapel visar ${props.grain === 'week' ? 'veckans' : 'månadens'} lägsta till högsta skattning, punkten snittet. Tryck för detaljer.`
            : 'Tryck på en stapel för detaljer.'}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {/* The scale: +3, +2, 0, −2, −3 at their heights. */}
        <View style={{ width: AXIS_W, height: MOOD_HALF * 2 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {[3, 2, 0, -2, -3].map((v) => (
            <Text key={v} style={{ position: 'absolute', top: moodY(v) - 7, left: 0, fontSize: 11, lineHeight: 14, color: colors.textMuted }}>{signed(v)}</Text>
          ))}
        </View>
        <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ flex: 1, height: MOOD_HALF * 2, flexDirection: 'row', gap: 2 }}>
          {/* Faint lines at ±2, the middle line at 0. */}
          {[2, -2].map((v) => (
            <View key={v} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: moodY(v), borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.border }} />
          ))}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF, borderTopWidth: 1, borderColor: colors.textMuted }} />
          {props.points.map((p) => {
            const v = p.value;
            const on = picked?.key === p.key;
            const fill = on ? colors.text : colors.accent;
            let mark: React.ReactNode = null;
            if (v != null && props.averaged) {
              const lo = p.min ?? v;
              const hi = p.max ?? v;
              const top = moodY(hi);
              const height = Math.max(6, moodY(lo) - top);
              mark = (
                <>
                  <View style={{ position: 'absolute', alignSelf: 'center', width: 6, top: height === 6 ? top - 3 : top, height, borderRadius: 3, backgroundColor: fill, opacity: on ? 0.9 : 0.35 }} />
                  <View style={{ position: 'absolute', alignSelf: 'center', top: moodY(v) - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: fill, borderWidth: 2, borderColor: colors.surface }} />
                </>
              );
            } else if (v != null) {
              const h = (Math.abs(v) / MOOD_MAX) * MOOD_HALF;
              mark = v > 0
                ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: MOOD_HALF, height: h, backgroundColor: fill, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                : v < 0
                  ? <View style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF, height: h, backgroundColor: fill, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
                  : <View style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF - 2, height: 4, borderRadius: 2, backgroundColor: fill }} />;
            }
            return (
              <Pressable key={p.key} onPress={() => setPicked(on ? null : p)} importantForAccessibility="no" accessibilityElementsHidden style={{ flex: 1, height: MOOD_HALF * 2 }}>
                {mark}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ marginLeft: AXIS_W }}>
        <Axis points={props.points} />
      </View>
      <Text style={[type.small, { fontSize: 12, marginTop: space.xs }]} importantForAccessibility="no" accessibilityElementsHidden>
        +3 Akut mani · +2 Uppvarvning · 0 Balanserad · −2 Depression · −3 Akut depression
      </Text>
    </Card>
  );
}

/** Levels per week or month: one stacked bar per bucket, green at the bottom and red on top. */
function LevelBars(props: { buckets: TrendBucket[]; grain: Grain }) {
  const [picked, setPicked] = useState<TrendBucket | null>(null);
  const most = Math.max(1, ...props.buckets.map((b) => b.days.length));
  const readout = (b: TrendBucket) =>
    `${bucketName(b, props.grain)}: ${[`${b.counts.green} gröna`, `${b.counts.yellow} gula`, `${b.counts.red} röda`, b.missing ? `${b.missing} utan` : null].filter(Boolean).join(', ')}`;
  return (
    <>
      <Text style={[type.small, { marginBottom: space.s }]} accessibilityLiveRegion="polite">
        {picked ? readout(picked) : `En stapel ${GRAIN_TEXT[props.grain]}. Tryck på en stapel för detaljer.`}
      </Text>
      <View accessible accessibilityRole="image" accessibilityLabel={`Nivå ${GRAIN_TEXT[props.grain]}. ${props.buckets.map(readout).join('. ')}`} style={{ height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {props.buckets.map((b) => (
          <Pressable key={b.key} onPress={() => setPicked(picked?.key === b.key ? null : b)} importantForAccessibility="no" accessibilityElementsHidden style={{ flex: 1, height: CHART_HEIGHT, justifyContent: 'flex-end', gap: 2, opacity: picked && picked.key !== b.key ? 0.45 : 1 }}>
            {(['red', 'yellow', 'green'] as const).map((l) => (b.counts[l] ? (
              <View key={l} style={{ height: Math.max(3, (b.counts[l] / most) * CHART_HEIGHT - 2), backgroundColor: levelColor(l), borderRadius: 3 }} />
            ) : null))}
          </Pressable>
        ))}
      </View>
      <Axis points={props.buckets.map((b) => ({ key: b.key, short: b.label, name: '', value: null }))} />
    </>
  );
}

/** Levels per day: one 44-point cell per day, seven to a row; a tap opens the day's assessment. */
function LevelCells({ days }: { days: TrendDay[] }) {
  const repo = useRepo();
  const nav = useNav();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
      {days.map((d) => {
        const e = d.level ? repo.entryFor(d.date) : null;
        return (
          <Pressable
            key={d.date}
            disabled={!e}
            onPress={() => e && nav.push({ name: 'result', entryId: e.id })}
            accessibilityRole={e ? 'button' : 'text'}
            accessibilityLabel={`${formatDateSv(d.date)}: ${d.level ? LEVEL_TEXT[d.level] : 'inget inlägg'}`}
            accessibilityHint={e ? 'Visar bedömningen' : undefined}
            style={({ pressed }) => ({ width: MIN_TOUCH, minHeight: MIN_TOUCH + 6, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.s, opacity: pressed ? 0.5 : 1 })}
          >
            <Dot level={d.level} size={days.length <= 7 ? 22 : 18} />
            <Text style={{ fontSize: 11, lineHeight: 13, color: colors.textMuted }} importantForAccessibility="no" accessibilityElementsHidden>{Number(d.date.slice(8, 10))}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** How well the routines were kept: the share for the period, over time, and per routine. */
function Routines(props: { buckets: TrendBucket[]; grain: Grain; today: string; days: number }) {
  const repo = useRepo();
  const nav = useNav();
  const ctx = repo.contextEntries();
  const tracked = trackedRoutines(ctx);
  const stats = routineStats(ctx, props.today, props.days).filter((s) => s.done > 0 || tracked.some((t) => t.id === s.routine.id));
  const done = props.buckets.reduce((n, b) => n + (b.routines?.done ?? 0), 0);
  const answered = props.buckets.reduce((n, b) => n + (b.routines?.answered ?? 0), 0);
  const evenings = props.buckets.reduce((n, b) => n + b.days.filter((d) => d.routines).length, 0);
  if (!stats.length) {
    return (
      <Card>
        <P muted>Du har inga rutiner att bocka av i kvällens avstämning.</P>
        <Button kind="ghost" title="Rutiner" hint="Visar rutinerna från din plan" onPress={() => nav.push({ name: 'routines' })} />
      </Card>
    );
  }
  if (!answered) {
    return (
      <Card>
        <P muted>Inga rutiner avbockade under perioden. Du bockar av dem i kvällens avstämning.</P>
      </Card>
    );
  }
  const pct = Math.round((done / answered) * 100);
  return (
    <>
      <Card>
        <View accessible accessibilityLabel={`${pct} procent av rutinerna hölls, räknat på ${evenings} ${evenings === 1 ? 'kväll' : 'kvällar'} du bockade av`}>
          <Text style={[type.title, { color: colors.text }]}>{pct} %</Text>
          <Text style={type.body}>av rutinerna hölls</Text>
          <Text style={type.small}>Räknat på {evenings === 1 ? 'en kväll' : `${evenings} kvällar`} du bockade av. En kväll utan avstämning räknas inte som missad.</Text>
        </View>
        {stats.map((s) => {
          const share = s.answered ? s.done / s.answered : 0;
          return (
            <View key={s.routine.id} style={{ marginTop: space.m }} accessible accessibilityLabel={`${s.routine.text}: ${s.done} av ${s.answered} kvällar`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                <Text style={[type.body, { flexShrink: 1 }]}>{s.routine.text}</Text>
                <Text style={[type.small, { fontWeight: '600', flexShrink: 0 }]}>{s.done} av {s.answered}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: space.xs, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(share * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
              </View>
            </View>
          );
        })}
      </Card>
      {props.buckets.length > 1 ? (
        <BarChart
          title={`Andel hållna ${GRAIN_TEXT[props.grain]}`}
          points={props.buckets.map((b) => ({ key: b.key, short: b.label, name: bucketName(b, props.grain), value: b.routines ? Math.round((b.routines.done / b.routines.answered) * 100) : null }))}
          unit="%"
          averaged={false}
          max={100}
        />
      ) : null}
    </>
  );
}

function rangeText(from: string, to: string, long: boolean): string {
  const f = (k: string) => `${Number(k.slice(8, 10))} ${MONTH_NAMES[Number(k.slice(5, 7)) - 1].slice(0, 3)}${long ? ` ${k.slice(0, 4)}` : ''}`;
  return `${f(from)} – ${f(to)}`;
}

/**
 * The Trend tab. One period for the whole page (7 days, 30 days, 6 months, 1 year), then the
 * level, mood, routines, sleep and stress in that order. Short periods show each day; 6 months
 * shows weeks and a year months, so the bars stay readable and wide enough to tap.
 */
export function TrendScreen() {
  const repo = useRepo();
  const nav = useNav();
  const stored = repo.kvGet(PERIOD_KEY) as TrendPeriod | undefined;
  const [period, setPeriodState] = useState<TrendPeriod>(stored && PERIODS.includes(stored) ? stored : '30d');
  const setPeriod = (p: TrendPeriod) => { setPeriodState(p); void repo.kvSet(PERIOD_KEY, p); };
  const [asList, setAsList] = useState(false);
  const today = eveningDateKey(new Date());
  const days = PERIOD_DAYS[period];
  const grain = PERIOD_GRAIN[period];
  const trend = useMemo(
    () => buildTrend(repo.entries(), repo.assessments(), repo.allMeasuredDays(), today, days, repo.contextEntries()),
    [repo, repo.revision, today, days],
  );
  const buckets = useMemo(() => bucketTrend(trend.days, grain), [trend, grain]);
  const averaged = grain !== 'day';
  const point = (value: (b: TrendBucket) => number | null): Point[] =>
    buckets.map((b) => ({ key: b.key, short: b.label, name: bucketName(b, grain), value: value(b) }));
  const limit = repo.planSettings().sleepThresholdHours;
  // Garmin connected, but no values from the start of a long period: offer to fetch them.
  const oldestGarmin = useMemo(() => Object.keys(repo.allGarminDays()).sort()[0] ?? null, [repo, repo.revision]);
  const missingGarmin = averaged && repo.garminStatus().connected && oldestGarmin != null && oldestGarmin > addDays(trend.days[0].date, 14);

  return (
    <Screen title="Trend">
      <Segmented
        label="Period"
        options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        value={period}
        onChange={setPeriod}
      />
      <Text style={[type.small, { marginTop: space.s }]}>
        {rangeText(trend.days[0].date, today, period === '6m' || period === '1y')}{averaged ? ` · en stapel ${GRAIN_TEXT[grain]}` : ''}
      </Text>

      <Section title="Nivå">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, marginBottom: space.s }}>
            {(['green', 'yellow', 'red'] as const).map((l) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH }} accessible accessibilityLabel={`${LEVEL_TEXT[l]}: ${trend.counts[l]} dagar`}>
                <Dot level={l} size={20} />
                <Text style={type.body}>{`${LEVEL_TEXT[l]} ${trend.counts[l]}`}</Text>
              </View>
            ))}
            <Text style={[type.small, { alignSelf: 'center' }]}>{`Utan inlägg ${trend.missing}`}</Text>
          </View>
          {averaged ? <LevelBars buckets={buckets} grain={grain} /> : <LevelCells days={trend.days} />}
        </Card>
      </Section>

      <Section title="Stämning">
        <MoodChart points={buckets.map((b) => ({ key: b.key, short: b.label, name: bucketName(b, grain), value: b.mood, min: b.moodMin, max: b.moodMax }))} averaged={averaged} grain={grain} />
      </Section>

      <Section title="Rutiner">
        <Routines buckets={buckets} grain={grain} today={today} days={days} />
      </Section>

      <Section title="Sömn och stress">
        {missingGarmin ? (
          <Card>
            <P>Garmins värden äldre än {formatDateSv(oldestGarmin!)} saknas, så sömn och stress visas bara för en del av perioden.</P>
            <Button kind="ghost" title="Hämta från Garmin" hint="Öppnar Garmin, där ett år bakåt kan hämtas" onPress={() => nav.push({ name: 'garmin' })} />
          </Card>
        ) : null}
        <BarChart title="Sömn" points={point((b) => b.sleepHours)} unit="h" averaged={averaged} reference={{ value: limit, label: `Streckad linje: din gräns på ${dec(limit)} h` }} />
        <BarChart title="Stress" points={point((b) => b.stressAvg)} unit="" averaged={averaged} reference={{ value: RULES.stressHighAt, label: `Streckad linje: ${RULES.stressHighAt}, gränsen för hög stress` }} />
      </Section>

      <Button kind="secondary" title={asList ? 'Dölj dagarna' : 'Visa dagarna som lista'} onPress={() => setAsList(!asList)} />
      {asList ? (
        <Card>
          {[...trend.days].reverse().map((d) => {
            const e = d.level ? repo.entryFor(d.date) : null;
            return (
              <Pressable
                key={d.date}
                disabled={!e}
                onPress={() => e && nav.push({ name: 'result', entryId: e.id })}
                accessibilityRole={e ? 'button' : 'text'}
                style={{ minHeight: MIN_TOUCH, paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: space.m }}
              >
                <Dot level={d.level} size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{formatDateSv(d.date)}</Text>
                  <Text style={type.small}>
                    {[
                      d.level ? LEVEL_TEXT[d.level] : 'Inget inlägg',
                      d.mood != null ? moodText(d.mood).toLowerCase() : null,
                      d.routines ? `rutiner ${d.routines.done} av ${d.routines.answered}` : null,
                      d.sleepHours != null ? `sömn ${dec(d.sleepHours)} h` : null,
                      d.stressAvg != null ? `stress ${d.stressAvg}` : null,
                    ].filter(Boolean).join(', ')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
      <P muted style={{ marginTop: space.m }}>
        Trenden visar dina egna värden. Nivån räknas varje kväll i appen, med samma regler.
      </P>
    </Screen>
  );
}
