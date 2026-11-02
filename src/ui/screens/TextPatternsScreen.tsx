// Mina tidigare texter: what would be sent (shown before anything is), the patterns the model
// proposes with their quotes and counterexamples, the person's approval, and a retrospective
// evaluation with one period held out. Experimental: approval is not clinical validation.

import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type { ReferenceText, TextPattern } from '../../core/domain/types';
import { DIRECTION_TEXT, PERIOD_TEXT, PHENOMENON_TEXT, periodsOf, usableReferences } from '../../core/references/references';
import {
  decidePattern, evaluateHoldOut, evaluations, outgoingPreview, proposePatterns, referenceTexts, removePattern,
  setTextPatternsEnabled, textPatterns, textPatternsEnabled,
} from '../../services/references';
import { Button, Card, Chip, Disclosure, P, Row, Screen, Section, Toggle } from '../components';
import { useDialog, useRepo } from '../state';
import { useNav } from '../nav';
import { llmStatus } from '../../services/llm';
import { colors, space, type } from '../theme';

const STATUS_TEXT: Record<TextPattern['status'], string> = {
  proposed: 'Förslag',
  approved: 'Godkänt för experimentell användning',
  rejected: 'Avvisat',
  needs_review: 'Måste godkännas igen: en källa är borttagen eller avstängd',
};

function refLabel(id: string, refs: ReferenceText[]): string {
  const r = refs.find((x) => x.id === id);
  return r ? `${PERIOD_TEXT[r.periodType].toLowerCase()}, ${r.approxDate ? `ca ${r.approxDate}` : 'okänt datum'}, ${r.periodId}` : 'borttagen text';
}

function PatternCard({ p, refs }: { p: TextPattern; refs: ReferenceText[] }) {
  const repo = useRepo();
  const dialog = useDialog();
  const periods = periodsOf(p, refs);
  const signText = p.planSignId ? repo.plan().find((x) => x.id === p.planSignId)?.text : null;
  return (
    <Card>
      <Text style={[type.body, { fontWeight: '600' }]}>{p.description}</Text>
      <Text style={type.small}>Riktning {DIRECTION_TEXT[p.direction]} · {PHENOMENON_TEXT[p.phenomenon]} · {STATUS_TEXT[p.status]}</Text>
      <Text style={[type.label, { marginTop: space.s }]}>BELÄGG, {new Set(p.evidence.map((e) => e.refId)).size} TEXTER, {periods.length === 1 ? 'EN PERIOD' : `${periods.length} PERIODER`}</Text>
      {p.evidence.map((e, i) => <P key={i} style={{ marginTop: 2 }}>{`”${e.quote}” (${refLabel(e.refId, refs)})`}</P>)}
      {p.counterExamples.length ? (
        <>
          <Text style={[type.label, { marginTop: space.s }]}>MOTEXEMPEL</Text>
          {p.counterExamples.map((e, i) => <P key={i} muted style={{ marginTop: 2 }}>{`”${e.quote}” (${refLabel(e.refId, refs)})${e.note ? `: ${e.note}` : ''}`}</P>)}
        </>
      ) : <Text style={[type.small, { marginTop: space.s }]}>Inga motexempel.</Text>}
      {p.alternatives.length ? (
        <>
          <Text style={[type.label, { marginTop: space.s }]}>ANDRA MÖJLIGA FÖRKLARINGAR</Text>
          {p.alternatives.map((a) => <P key={a} muted style={{ marginTop: 2 }}>{`• ${a}`}</P>)}
        </>
      ) : null}
      {signText ? <Text style={[type.small, { marginTop: space.s }]}>Samma som tecknet ”{signText}” i din plan. Då räknas tecknet, inte mönstret.</Text> : null}
      {p.rejectedObservations ? <Text style={[type.small, { marginTop: space.xs }]}>Du har sagt att {p.rejectedObservations === 1 ? 'en observation' : `${p.rejectedObservations} observationer`} inte stämde.</Text> : null}
      <Row style={{ marginTop: space.xs }}>
        {p.status !== 'approved' && p.status !== 'rejected' ? (
          <Button title="Godkänn" label={`Godkänn mönstret ${p.description}`} onPress={async () => {
            const ok = await dialog.confirm({
              title: 'Godkänna mönstret?',
              message: 'Det får då användas experimentellt i kvällens bedömning och kan ge 1 poäng. Det betyder inte att mönstret är kliniskt prövat.',
              confirmLabel: 'Godkänn',
            });
            if (ok) await decidePattern(repo, p.id, 'approved');
          }} />
        ) : null}
        {p.status === 'approved' ? <Button kind="secondary" title="Sluta använda" onPress={() => decidePattern(repo, p.id, 'rejected')} /> : null}
        {p.status === 'proposed' || p.status === 'needs_review' ? <Button kind="ghost" title="Avvisa" onPress={() => decidePattern(repo, p.id, 'rejected')} /> : null}
        {p.status === 'rejected' ? <Button kind="ghost" title="Ta bort" onPress={() => removePattern(repo, p.id)} /> : null}
      </Row>
    </Card>
  );
}

export function TextPatternsScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const refs = referenceTexts(repo);
  const patterns = textPatterns(repo);
  const enabled = textPatternsEnabled(repo);
  const preview = outgoingPreview(repo);
  const browser = Platform.OS === 'web';
  const periodIds = [...new Set(usableReferences(refs).map((r) => r.periodId))];

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      await dialog.info('Det gick inte', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const order: TextPattern['status'][] = ['needs_review', 'proposed', 'approved', 'rejected'];
  // Proposing patterns needs a model on this device: say why it cannot, before the person tries.
  const [llm, setLlm] = useState<{ ready: boolean; message: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    llmStatus(repo).then((st) => live && setLlm(st)).catch(() => undefined);
    return () => { live = false; };
  }, [repo]);

  return (
    <Screen title="Mönster">
      <Section title="Det här skickas">
        <Card>
          <P>
            När mönster föreslås: {preview.proposal.length === 1 ? 'en text, rensad' : `${preview.proposal.length} texter, rensade`}, högst 1 500 tecken var. Varje kväll:
            anteckningen, rensad, och {preview.references.length === 1 ? 'ett utdrag' : `${preview.references.length} utdrag`}, högst två per period.
          </P>
          {preview.excludedAkut.length ? (
            <Text style={[type.small, { marginTop: space.xs }]}>
              {preview.excludedAkut.length === 1 ? 'En text skickas aldrig: den har' : `${preview.excludedAkut.length} texter skickas aldrig: de har`} formuleringar som akutregeln reagerar på.
            </Text>
          ) : null}
          {preview.stableMissing ? <Text style={[type.small, { marginTop: space.xs }]}>Inga texter från stabila perioder finns med. Jämförelsen blir osäker.</Text> : null}
          <Disclosure title="Visa utdragen">
            {preview.references.map((r) => <P key={r.id} muted style={{ marginTop: space.xs }}>{`${refLabel(r.id, refs)}: ${r.sent}`}</P>)}
            {preview.note ? <P muted style={{ marginTop: space.s }}>{`Din senaste anteckning, så som den skulle skickas: ${preview.note}`}</P> : null}
          </Disclosure>
          {enabled ? (
            <Toggle label="Jämför kvällens anteckning med mina mönster" value onChange={(v) => setTextPatternsEnabled(repo, v)} />
          ) : (
            <Button title="Slå på jämförelsen" onPress={async () => {
              const ok = await dialog.confirm({
                title: 'Slå på jämförelsen?',
                message: 'Texterna ovan skickas rensade till din språkmodell när du ber om mönster, och anteckningen med utdragen varje kväll. Godkända mönster kan ge upp till 2 poäng och höja nivån. Anteckningar som akutregeln reagerar på skickas aldrig.',
                confirmLabel: 'Slå på',
              });
              if (ok) await setTextPatternsEnabled(repo, true);
            }} />
          )}
        </Card>
      </Section>

      {llm && !llm.ready ? (
        <Card tone="yellow" style={{ marginTop: space.m }}>
          <P>{llm.message}</P>
          <Button kind="secondary" title="Öppna Språkmodell" onPress={() => nav.push({ name: 'llm' })} />
        </Card>
      ) : null}

      <Section title="Mönster">
        <Button
          kind="secondary"
          title="Föreslå mönster"
          busy={busy === 'propose'}
          disabled={!enabled}
          onPress={() => run('propose', async () => {
            const r = await proposePatterns(repo, { browser });
            await dialog.info('Förslag', `${r.added === 1 ? 'Ett mönster' : `${r.added} mönster`} att granska.${r.dropped.length ? ` ${r.dropped.length} förslag togs bort: citaten fanns inte ordagrant eller belägg saknades från två texter.` : ''}`);
          })}
        />
        {order.flatMap((s) => patterns.filter((p) => p.status === s)).map((p) => <PatternCard key={p.id} p={p} refs={refs} />)}
        {!patterns.length ? <P muted>Inga mönster än.</P> : null}
      </Section>

      <Section title="Utvärdering">
        <Card>
          <P muted>En hel period hålls utanför. Mönster föreslås från de andra, och periodens texter jämförs med dem. Räknas mot din egen märkning, inte mot ampeln.</P>
          <Row style={{ marginTop: space.s, gap: 6 }}>
            {periodIds.map((id) => <Chip key={id} label={id} selected={period === id} onPress={() => setPeriod(id)} />)}
          </Row>
          <Button
            kind="secondary"
            title="Utvärdera"
            disabled={!enabled || !period}
            busy={busy === 'eval'}
            onPress={() => run('eval', async () => { await evaluateHoldOut(repo, period!, { browser }); })}
          />
          {evaluations(repo).slice(0, 5).map((e) => (
            <View key={e.at} style={{ marginTop: space.m, borderTopWidth: 1, borderColor: colors.border, paddingTop: space.s }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{e.summary.periodId} ({PERIOD_TEXT[e.summary.periodType].toLowerCase()})</Text>
              <P muted>
                {[
                  `${e.summary.texts} texter`,
                  `${e.summary.patternsFromRest} mönster från de andra perioderna`,
                  `avstod ${e.summary.abstained}`,
                  e.summary.falseSignals != null ? `signaler i stabil period ${e.summary.falseSignals}` : null,
                  e.summary.missed != null ? `utan observation åt periodens håll ${e.summary.missed}` : null,
                  e.summary.otherDirection ? `åt andra hållet ${e.summary.otherDirection}` : null,
                  e.summary.errors ? `fel ${e.summary.errors}` : null,
                ].filter(Boolean).join(', ')}. {e.model}, {e.at.slice(0, 10)}.
              </P>
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
