// Mina mönster (experimental): at most two recurring links between the watch's sleep and pulse
// and the person's own ratings, each with its counts, what speaks against it and the data behind
// it. The code finds and counts; a language model may word an explanation when the person has
// chosen it, and what is sent is shown here. A rating is called a rating, never an episode.

import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { formatDateSvYear } from '../../core/analysis/dates';
import {
  CANDIDATES, coverageLine, FEATURE_WORD, findingEvidence, findingSummary, findingTitle, followUpLine, insufficientLine, methodText, MOOD_WORD, relatedLine, statusLine,
  type PatternAnalysis,
} from '../../core/analysis/moodPatterns';
import { llmStatus } from '../../services/llm';
import { markPatternsSeen, outgoingFacts, patternExplanationsOn, patternStore, runPatterns, setPatternExplanations, shownFindings, type ShownFinding } from '../../services/moodPatterns';
import { Button, Card, Disclosure, P, Screen, Tag, Toggle } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { space, type } from '../theme';

function Label({ children }: { children: string }) {
  return <Text style={[type.label, { marginTop: space.m, marginBottom: space.xs }]} accessibilityRole="header">{children.toUpperCase()}</Text>;
}

function FindingCard({ f, a }: { f: ShownFinding; a: PatternAnalysis }) {
  const [open, setOpen] = useState(false);
  const e = findingEvidence(f.result, a);
  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">{findingTitle(f.result)}</Text>
      <P style={{ marginTop: space.xs }}>{findingSummary(f.result)}</P>
      {relatedLine(f.result, a) ? <P muted style={{ marginTop: space.xs }}>{relatedLine(f.result, a)}</P> : null}
      {!f.result.qualifies ? <P style={{ marginTop: space.xs }}>Med de senaste data är sambandet inte längre tydligt.</P> : null}
      {f.explanation ? (
        <View style={{ marginTop: space.s }}>
          <P>{f.explanation.text}</P>
          <P muted>Formulerat av AI utifrån siffrorna i underlaget, och kontrollerat mot dem.</P>
        </View>
      ) : null}
      <P muted style={{ marginTop: space.s }}>{followUpLine(f.hypothesis, f.later)}</P>
      <Button kind="ghost" title={open ? 'Dölj underlag' : 'Visa underlag'} onPress={() => setOpen(!open)} />
      {open ? (
        <View>
          <Label>Perioderna</Label>
          {e.periods.map((l) => <P key={l} style={{ marginBottom: space.xs }}>{l}</P>)}
          <Label>Motexempel</Label>
          {e.counterexamples.length ? e.counterexamples.map((l) => <P key={l} style={{ marginBottom: space.xs }}>{l}</P>) : <P>Inga i underlaget.</P>}
          <Label>Saknade data och underlag</Label>
          {e.missing.map((l) => <P key={l} style={{ marginBottom: space.xs }}>{l}</P>)}
        </View>
      ) : null}
    </Card>
  );
}

export function PatternsScreen() {
  const repo = useRepo();
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const store = patternStore(repo);
  const a = store.analysis;
  const shown = shownFindings(repo);
  const explain = patternExplanationsOn(repo);
  const outgoing = outgoingFacts(repo);

  useEffect(() => { markPatternsSeen(repo).catch(() => null); }, [repo, shown.length]);
  useEffect(() => {
    let live = true;
    llmStatus(repo).then((st) => live && setHasModel(st.ready)).catch(() => undefined);
    return () => { live = false; };
  }, [repo]);

  const run = async () => {
    setBusy(true);
    try {
      await runPatterns(repo, new Date(), { browser: Platform.OS === 'web' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Mina mönster">
      <Tag label="Experimentell" />
      <P style={{ marginTop: space.s }}>
        Appen letar efter samband som återkommer mellan klockans sömn och puls och dina egna skattningar av stämningsläget. Du behöver inte registrera något nytt.
      </P>
      <View style={{ height: space.m }} />

      {shown.map((f) => <FindingCard key={f.hypothesis.candidateId} f={f} a={a!} />)}

      {a && !shown.length ? (
        <Card>
          <Text style={type.h2} accessibilityRole="header">{statusLine(a)}</Text>
          {insufficientLine(a) ? <P style={{ marginTop: space.xs }}>{insufficientLine(a)}</P> : null}
          {a.status === 'none' ? <P style={{ marginTop: space.xs }}>Det betyder inte att det saknas samband, bara att inget återkom tillräckligt tydligt i det som finns sparat.</P> : null}
        </Card>
      ) : null}

      {!a ? (
        <Card>
          <P>Ingen analys är gjord än. Den görs av sig själv ungefär en gång i månaden när det finns minst 30 nätter från klockan och 30 skattade dagar.</P>
        </Card>
      ) : null}

      <Card>
        {a ? <P muted>Senast analyserat {formatDateSvYear(a.to)}. Görs om av sig självt ungefär en gång i månaden.</P> : null}
        <Button kind="secondary" title="Analysera nu" busy={busy} onPress={run} />
      </Card>

      {a ? (
        <Disclosure title="Så prövas det" detail={`${a.tested} samband, bestämda i förväg`}>
          <Card>
            <P>{methodText(a)}</P>
            <P muted style={{ marginTop: space.s }}>{coverageLine(a)}</P>
            {a.results.length ? (
              <>
                <Label>Det som prövades</Label>
                {a.results.map((r) => (
                  <P key={r.candidate.id} style={{ marginBottom: space.xs }}>
                    {FEATURE_WORD[r.candidate.pattern].charAt(0).toUpperCase() + FEATURE_WORD[r.candidate.pattern].slice(1)} och {MOOD_WORD[r.candidate.mood]}:{' '}
                    {r.periods.length ? `fanns vid ${r.hits} av ${r.periods.length} perioder` : 'inga perioder att jämföra med'}
                    {a.findings.some((f) => f.candidate.id === r.candidate.id) ? '. Visas som fynd.' : r.qualifies ? '. Håller också, och nämns med fyndet.' : '.'}
                  </P>
                ))}
              </>
            ) : (
              <>
                <Label>Det som prövas</Label>
                {CANDIDATES.map((c) => <P key={c.id}>{FEATURE_WORD[c.pattern].charAt(0).toUpperCase() + FEATURE_WORD[c.pattern].slice(1)} och {MOOD_WORD[c.mood]}.</P>)}
              </>
            )}
          </Card>
        </Disclosure>
      ) : null}

      <Disclosure title="Språkmodell · frivilligt" detail={explain ? 'Formulerar en förklaring av fynden' : 'Av. Analysen görs på telefonen.'}>
        <Card>
          <P>Analysen räknas alltid på telefonen. Du kan låta en språkmodell formulera en kort förklaring av ett fynd som redan är uträknat. Modellen räknar inget och avgör inget, och svaret kontrolleras mot siffrorna innan det visas.</P>
          <View style={{ marginTop: space.s }}>
            <Toggle
              label="Låt språkmodellen formulera"
              value={explain}
              disabled={!hasModel && !explain}
              onChange={async (on) => { setBusy(true); try { await setPatternExplanations(repo, on, { browser: Platform.OS === 'web' }); } finally { setBusy(false); } }}
              hint={hasModel ? 'Bara siffrorna nedan skickas: inga datum, inga anteckningar.' : 'Ingen språkmodell är kopplad.'}
            />
          </View>
          {!hasModel ? <Button kind="ghost" title="Koppla en språkmodell" onPress={() => nav.push({ name: 'llm' })} /> : null}
          <Label>{explain ? 'Det här skickas' : 'Det här skulle skickas'}</Label>
          {outgoing.length ? outgoing.map((o) => (
            <View key={o.title} style={{ marginBottom: space.s }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{o.title}</Text>
              <P muted>{o.sent}</P>
            </View>
          )) : <P muted>Inget. Något skickas först när det finns ett fynd.</P>}
        </Card>
      </Disclosure>
    </Screen>
  );
}
