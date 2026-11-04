import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { eveningDateKey, formatDateSv } from '../../core/analysis/dates';
import { buildTrend, type TrendDay } from '../../core/analysis/trend';
import { MOOD_MAX, moodStep, moodText } from '../../core/analysis/mood';
import { Button, Card, Chip, Dot, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, LEVEL_TEXT, MIN_TOUCH, radius, space, type } from '../theme';

const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const withUnit = (n: number, unit: string) => (unit ? `${dec(n)} ${unit}` : dec(n));
const CHART_HEIGHT = 120;

/**
 * One measure per chart (never two scales on one axis). Bars anchored to the baseline,
 * one hue, a 2-point gap between bars, a recessive reference line. Tapping a bar shows
 * its day and value; the same numbers are available as a list for VoiceOver.
 */
function BarChart(props: {
  title: string;
  days: TrendDay[];
  value: (d: TrendDay) => number | null;
  unit: string;
  reference?: { value: number; label: string };
}) {
  const [picked, setPicked] = useState<TrendDay | null>(null);
  const values = props.days.map(props.value).filter((v): v is number => v != null);
  const max = Math.max(1, ...values, props.reference?.value ?? 0) * 1.1;
  const withValue = values.length;
  const avg = withValue ? values.reduce((a, b) => a + b, 0) / withValue : null;
  const summary = withValue
    ? `${props.title}: ${withValue} av ${props.days.length} dagar har värden, i snitt ${withUnit(avg!, props.unit)}.`
    : `${props.title}: inga värden för perioden.`;
  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">{props.title}</Text>
      <Text style={[type.small, { marginBottom: space.s }]}>
        {picked
          ? `${formatDateSv(picked.date)}: ${props.value(picked) != null ? withUnit(props.value(picked)!, props.unit) : 'inget värde'}`
          : avg != null ? `Snitt ${withUnit(avg, props.unit)}. Tryck på en stapel för dagens värde.` : 'Inga värden för perioden.'}
      </Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {props.days.map((d) => {
          const v = props.value(d);
          return (
            <Pressable
              key={d.date}
              onPress={() => setPicked(picked?.date === d.date ? null : d)}
              importantForAccessibility="no"
              accessibilityElementsHidden
              style={{ flex: 1, height: CHART_HEIGHT, justifyContent: 'flex-end' }}
            >
              {v != null ? (
                <View
                  style={{
                    height: Math.max(2, (v / max) * CHART_HEIGHT),
                    backgroundColor: picked?.date === d.date ? colors.text : colors.accent,
                    borderTopLeftRadius: 4, borderTopRightRadius: 4,
                  }}
                />
              ) : null}
            </Pressable>
          );
        })}
        {/* The reference line on top of the bars, thin and recessive. */}
        {props.reference ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: (props.reference.value / max) * CHART_HEIGHT, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.text }}
          />
        ) : null}
      </View>
      {props.reference ? <Text style={[type.small, { marginTop: space.xs }]}>{props.reference.label}</Text> : null}
    </Card>
  );
}

const MOOD_HALF = 60;

/**
 * Stämning per day on the scale from −3 to +3: bars from the middle line, up towards mania and
 * down towards depression, so the direction is read from the position. Balanserad (0) shows as
 * a short mark on the line, a day without a rating as nothing. Tapping a bar shows its day.
 */
function MoodChart(props: { days: TrendDay[] }) {
  const [picked, setPicked] = useState<TrendDay | null>(null);
  const rated = props.days.filter((d) => d.mood != null);
  const up = rated.filter((d) => d.mood! > 0).length;
  const down = rated.filter((d) => d.mood! < 0).length;
  const summary = rated.length
    ? `Stämning: ${rated.length} av ${props.days.length} dagar skattade, ${down} under balanserad, ${rated.length - up - down} balanserad, ${up} över.`
    : 'Stämning: inga skattningar för perioden.';
  return (
    <Card>
      <Text style={[type.small, { marginBottom: space.s }]}>
        {picked
          ? `${formatDateSv(picked.date)}: ${picked.mood != null ? moodText(picked.mood) : 'ingen skattning'}`
          : rated.length ? 'Tryck på en stapel för dagens skattning.' : 'Inga skattningar för perioden.'}
      </Text>
      <Text style={[type.small, { fontSize: 12 }]} importantForAccessibility="no" accessibilityElementsHidden>Akut mani +3</Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ height: MOOD_HALF * 2, flexDirection: 'row', gap: 2 }}>
        {props.days.map((d) => {
          const v = d.mood;
          const h = v == null ? 0 : Math.max(3, (Math.abs(v) / MOOD_MAX) * MOOD_HALF);
          const fill = picked?.date === d.date ? colors.text : colors.accent;
          return (
            <Pressable
              key={d.date}
              onPress={() => setPicked(picked?.date === d.date ? null : d)}
              importantForAccessibility="no"
              accessibilityElementsHidden
              style={{ flex: 1, height: MOOD_HALF * 2 }}
            >
              {v != null && v > 0 ? (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: MOOD_HALF, height: h, backgroundColor: fill, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              ) : null}
              {v != null && v < 0 ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF, height: h, backgroundColor: fill, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
              ) : null}
              {v === 0 ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF - 2, height: 4, borderRadius: 2, backgroundColor: fill }} />
              ) : null}
            </Pressable>
          );
        })}
        {/* The middle line, Balanserad: thin and recessive, under the bars' ends. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: MOOD_HALF, borderTopWidth: 1, borderColor: colors.border }} />
      </View>
      <Text style={[type.small, { fontSize: 12 }]} importantForAccessibility="no" accessibilityElementsHidden>Akut depression −3</Text>
      {picked?.mood != null ? <Text style={[type.small, { marginTop: space.xs }]}>{moodStep(picked.mood).hint}</Text> : null}
    </Card>
  );
}

/** The Trend tab: the last 14 or 30 days, level, mood, sleep and stress. */
export function TrendScreen() {
  const repo = useRepo();
  const nav = useNav();
  const [length, setLength] = useState<14 | 30>(14);
  const [asList, setAsList] = useState(false);
  const today = eveningDateKey(new Date());
  const trend = useMemo(
    () => buildTrend(repo.entries(), repo.assessments(), repo.allMeasuredDays(), today, length),
    [repo, repo.revision, today, length],
  );
  const limit = repo.planSettings().sleepThresholdHours;

  return (
    <Screen title="Trend">
      <Row style={{ marginBottom: space.m }}>
        <Chip label="14 dagar" selected={length === 14} onPress={() => setLength(14)} />
        <Chip label="30 dagar" selected={length === 30} onPress={() => setLength(30)} />
      </Row>

      <Section title="Nivå per dag">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginBottom: space.m }}>
            {(['green', 'yellow', 'red'] as const).map((l) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH }} accessible accessibilityLabel={`${LEVEL_TEXT[l]}: ${trend.counts[l]} dagar`}>
                <Dot level={l} size={20} />
                <Text style={type.body}>{`${LEVEL_TEXT[l]} ${trend.counts[l]}`}</Text>
              </View>
            ))}
            <Text style={[type.small, { alignSelf: 'center' }]}>{`Utan inlägg ${trend.missing}`}</Text>
          </View>
          {/* One cell per day, 44 points wide (seven to a row on a phone): a tap opens that day's assessment. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
            {trend.days.map((d) => {
              const e = d.level ? repo.entryFor(d.date) : null;
              const day = Number(d.date.slice(8, 10));
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
                  <Dot level={d.level} size={length === 14 ? 20 : 18} />
                  <Text style={{ fontSize: 11, lineHeight: 13, color: colors.textMuted }} importantForAccessibility="no" accessibilityElementsHidden>{day}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      </Section>

      <Section title="Stämning">
        <MoodChart days={trend.days} />
      </Section>

      <Section title="Sömn och stress">
        <BarChart title="Sömn" days={trend.days} value={(d) => d.sleepHours} unit="h" reference={{ value: limit, label: `Streckad linje: din gräns på ${dec(limit)} h` }} />
        <BarChart title="Stress" days={trend.days} value={(d) => d.stressAvg} unit="" />
      </Section>

      <Button kind="secondary" title={asList ? 'Dölj listan' : 'Visa som lista'} onPress={() => setAsList(!asList)} />
      {asList ? (
        <Card>
          {[...trend.days].reverse().map((d) => (
            <Pressable
              key={d.date}
              onPress={() => {
                const e = repo.entryFor(d.date);
                if (e) nav.push({ name: 'result', entryId: e.id });
              }}
              accessibilityRole="button"
              style={{ minHeight: MIN_TOUCH, paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: space.m }}
            >
              <Dot level={d.level} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{formatDateSv(d.date)}</Text>
                <Text style={type.small}>
                  {[d.level ? LEVEL_TEXT[d.level] : 'Inget inlägg', d.mood != null ? moodText(d.mood).toLowerCase() : null, d.sleepHours != null ? `sömn ${dec(d.sleepHours)} h` : null, d.stressAvg != null ? `stress ${d.stressAvg}` : null].filter(Boolean).join(', ')}
                </Text>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <P muted style={{ marginTop: space.m, borderRadius: radius.s }}>
        Trenden visar dina egna värden. Nivån räknas varje kväll i appen, med samma regler.
      </P>
    </Screen>
  );
}
