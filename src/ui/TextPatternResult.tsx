// Under the assessment: what Mina tidigare texter changed. The level without and with personal
// text patterns, the observations that added points with today's quote and the reference
// texts' dates, what did not count and why, and the person's way to say one did not fit.

import React from 'react';
import { Text, View } from 'react-native';
import type { Assessment, ReferenceText, TextObservationResult, TextPattern } from '../core/domain/types';
import { DIRECTION_TEXT, PERIOD_TEXT } from '../core/references/references';
import { referenceTexts, rejectObservation, textPatterns } from '../services/references';
import { Button, Card, P, Section } from './components';
import { useDialog, useRepo } from './state';
import { colors, LEVEL_TEXT, space, type } from './theme';

const periodPart = (r: ReferenceText) => `${PERIOD_TEXT[r.periodType].toLowerCase()} (${[r.periodId, r.approxDate ? `ca ${r.approxDate}` : null].filter(Boolean).join(', ')})`;

/**
 * "Mönstret kommer från texter du själv märkt som uppvarvad eller mani (Våren 2024)." From the
 * pattern's own evidence, not from the excerpts the model happened to cite.
 */
function whereFrom(o: TextObservationResult, refs: ReferenceText[], patterns: TextPattern[]): string {
  const p = patterns.find((x) => x.id === o.patternId);
  const sources = (p?.evidence ?? []).map((e) => refs.find((r) => r.id === e.refId)).filter((r): r is ReferenceText => !!r);
  if (!sources.length) return '';
  const own = sources.every((r) => r.labelSource === 'self_after') ? 'du själv märkt' : 'märkts';
  return `Mönstret kommer från texter ${own} som ${[...new Set(sources.map(periodPart))].join('; ')}.`;
}

export function TextPatternResult({ a }: { a: Assessment }) {
  const repo = useRepo();
  const dialog = useDialog();
  const t = a.textPatterns;
  if (!t) return null;
  const refs = referenceTexts(repo);
  const patterns = textPatterns(repo);
  const counted = t.observations.filter((o) => o.counted && !o.rejectedAt);
  const other = t.observations.filter((o) => !o.counted || o.rejectedAt);
  const changed = t.levelWithout !== a.level;
  return (
    <Section title="Mina tidigare texter">
      <Card>
        <P>
          {changed
            ? `Utan textmönster: ${LEVEL_TEXT[t.levelWithout].toLowerCase()} (${t.pointsWithout} poäng). Med dem: ${LEVEL_TEXT[a.level].toLowerCase()} (${a.points} poäng).`
            : `Nivån blev ${LEVEL_TEXT[a.level].toLowerCase()} med och utan textmönster.`}
        </P>
        {t.error ? <P muted style={{ marginTop: space.xs }}>Jämförelsen gick inte att göra. Inget därifrån räknades.</P> : null}
        {t.abstained ? <P muted style={{ marginTop: space.xs }}>{`Modellen avstod${t.abstainReason ? `: ${t.abstainReason}` : ''}. Det säger inget om hur du mår.`}</P> : null}
        {t.stableMissing ? <P muted style={{ marginTop: space.xs }}>Inga texter från stabila perioder fanns att jämföra med.</P> : null}

        {counted.map((o) => (
          <View key={o.patternId + o.quote} style={{ marginTop: space.m, borderTopWidth: 1, borderColor: colors.border, paddingTop: space.s }}>
            <Text style={[type.body, { fontWeight: '600' }]}>”{o.quote}”</Text>
            <P style={{ marginTop: 2 }}>{`Liknar ditt mönster: ${o.description} (riktning ${DIRECTION_TEXT[o.direction]}). Gav 1 poäng.`}</P>
            {whereFrom(o, refs, patterns) ? <Text style={[type.small, { marginTop: 2 }]}>{whereFrom(o, refs, patterns)}</Text> : null}
            {o.note ? <Text style={[type.small, { marginTop: 2 }]}>{o.note}</Text> : null}
            <Button kind="ghost" title="Stämmer inte" label={`Säg att observationen ${o.quote} inte stämmer`} onPress={async () => {
              const ok = await dialog.confirm({
                title: 'Stämmer inte?',
                message: 'Observationen slutar räknas och dagen räknas om. Dina texter och deras märkning ändras inte.',
                confirmLabel: 'Stämmer inte',
              });
              if (ok) await rejectObservation(repo, a.id, o.patternId, o.quote);
            }} />
          </View>
        ))}

        {other.length ? (
          <View style={{ marginTop: space.m }}>
            <Text style={type.label}>RÄKNADES INTE</Text>
            {other.map((o) => <P key={o.patternId + o.quote} muted style={{ marginTop: 2 }}>{`”${o.quote}”: ${o.rejectedAt ? 'du sa att den inte stämde' : (o.reason ?? 'räknades inte').toLowerCase()}`}</P>)}
          </View>
        ) : null}
        {t.differences.length ? (
          <View style={{ marginTop: space.m }}>
            <Text style={type.label}>SKILLNADER MOT STABILA TEXTER</Text>
            {t.differences.map((d) => <P key={d} muted style={{ marginTop: 2 }}>{`• ${d}`}</P>)}
          </View>
        ) : null}
        {t.uncertainties.length ? (
          <View style={{ marginTop: space.m }}>
            <Text style={type.label}>OSÄKERHETER</Text>
            {t.uncertainties.map((d) => <P key={d} muted style={{ marginTop: 2 }}>{`• ${d}`}</P>)}
          </View>
        ) : null}
        <P muted style={{ marginTop: space.m }}>Experimentellt. En observation är en likhet med dina egna texter, inte en bedömning av hur du mår.</P>
      </Card>
    </Section>
  );
}
