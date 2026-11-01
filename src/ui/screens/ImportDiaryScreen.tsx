import React, { useMemo, useRef, useState } from 'react';
import { Text } from 'react-native';
import { formatDateSvYear as formatDateSv } from '../../analysis/dates';
import { MOOD_BALANCED, MOOD_VALUES, SOURCE_NAME, type DiaryImport } from '../../import/bipolarDagbok';
import { signalCounts, suggestMapping, type BuildResult, type Mapping } from '../../import/transform';
import { pickTextFiles } from '../../platform/files';
import { backfillGarmin, backfillState } from '../../services/garminHistory';
import { overlapWith, parseDiaryFiles, periodOf, runDiaryImport } from '../../services/diaryImport';
import { Button, Card, Chip, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { space, type } from '../theme';

type Step = 'start' | 'review' | 'running' | 'done';

// The diary's low mood levels are named with diagnosis words; the app shows only the numbers.
const LOW_VALUES = Object.entries(MOOD_VALUES).filter(([k]) => k.startsWith('Lågt')).map(([, v]) => v).sort((a, b) => b - a).join(', ');
const HIGH_VALUES = Object.entries(MOOD_VALUES).filter(([k]) => k.startsWith('Högt')).map(([k, v]) => `${v} (${k.split(': ')[1]})`).join(' eller ');

/**
 * Import from another mood diary. The files are read on the device; nothing is sent to
 * a language model. The user links the diary's columns to their own signs before
 * anything is saved, and an import can be removed again as a whole.
 */
export function ImportDiaryScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const [step, setStep] = useState<Step>('start');
  const [parsed, setParsed] = useState<DiaryImport | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [withGarmin, setWithGarmin] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [garminNote, setGarminNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const signs = repo.plan().filter((p) => p.kind === 'early' || p.kind === 'serious');
  const garminConnected = repo.garminStatus().connected;
  // Items with a suggested sign first, so the likely links are checked first.
  const counts = useMemo(() => {
    const all = parsed ? signalCounts(parsed.days) : [];
    const suggested = parsed ? suggestMapping(all.map((c) => c.signal), repo.plan()) : {};
    return [...all.filter((c) => suggested[c.signal]), ...all.filter((c) => !suggested[c.signal])];
  }, [parsed, repo]);
  const period = parsed ? periodOf(parsed) : null;

  const pick = async () => {
    setError(null);
    const files = await pickTextFiles();
    if (!files.length) return;
    try {
      const p = parseDiaryFiles(files);
      if (!p.days.length) throw new Error('Filerna har inga ifyllda dagar.');
      setParsed(p);
      setMapping(suggestMapping(signalCounts(p.days).map((c) => c.signal), repo.plan()));
      setStep('review');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async () => {
    if (!parsed || !period) return;
    setStep('running');
    setError(null);
    stop.current = false;
    if (withGarmin && garminConnected) {
      setProgress('Hämtar sömn och stress från Garmin, nyast först…');
      const r = await backfillGarmin(repo, period.from, period.to, {
        cancelled: () => stop.current,
        onProgress: (p) => setProgress(
          p.state.nextEnd
            ? `Hämtar Garmin bakåt till ${formatDateSv(p.state.nextEnd)}. ${p.state.fetchedDays} dagar med värden hittills.`
            : `Garmin klart: ${p.state.fetchedDays} dagar med värden.`,
        ),
      });
      setGarminNote(
        r.error
          ? `Garmin: ${r.error} Dagarna importerades ändå, med de Garmin-värden som hann hämtas.`
          : r.state.oldestWithData
            ? `Garmin hade värden från ${formatDateSv(r.state.oldestWithData)}. Äldre dagar har inga mätvärden.`
            : 'Garmin hade inga värden för perioden.',
      );
    }
    try {
      const { result: res } = await runDiaryImport(repo, parsed, mapping, {
        onProgress: (done, total) => setProgress(`Räknar nivån för dag ${done} av ${total}…`),
      });
      setResult(res);
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
      setStep('review');
    } finally {
      setProgress(null);
    }
  };

  const remove = async (id: string, days: number) => {
    const ok = await dialog.confirm({
      title: 'Ta bort importen?',
      message: `${days} importerade dagar och deras bedömningar tas bort. Det du skrivit i Dagsljus och hämtade Garmin-värden ligger kvar.`,
      confirmLabel: 'Ta bort',
      danger: true,
    });
    if (!ok) return;
    const n = await repo.removeImport(id);
    await dialog.info('Importen är borttagen', `${n} dagar togs bort.`);
  };

  const imports = repo.imports();
  const saved = backfillState(repo);

  if (step === 'done' && result) {
    return (
      <Screen title="Importen är klar" back footer={<Button title="Visa historiken" onPress={() => nav.replace({ name: 'history' })} />}>
        <Card tone="green">
          <P>{`${result.entries.length} dagar importerades. Nivån räknades i appen med samma regler som en vanlig kväll.`}</P>
        </Card>
        <Card>
          <P>{`Grönt ${result.levels.green}, gult ${result.levels.yellow}, rött ${result.levels.red}.`}</P>
          {result.akut ? <P style={{ marginTop: space.xs }}>{`${result.akut} dagar träffade akutregeln och räknades som röda.`}</P> : null}
          {result.skipped.length ? <P style={{ marginTop: space.xs }}>{`${result.skipped.length} dagar fanns redan i Dagsljus och lämnades som de var.`}</P> : null}
          <P style={{ marginTop: space.xs }}>{`Sömn från Garmin ${result.sleepFromGarmin} dagar, från anteckningens sömnrad ${result.sleepFromNote} dagar.`}</P>
          {result.context.length ? <P style={{ marginTop: space.xs }}>{`${result.context.length} kvällar med medicin ej tagen.`}</P> : null}
        </Card>
        {garminNote ? <P muted>{garminNote}</P> : null}
      </Screen>
    );
  }

  if (step === 'review' || step === 'running') {
    if (!parsed || !period) return null;
    const overlap = overlapWith(repo, parsed);
    return (
      <Screen
        title="Granska importen"
        back
        footer={
          step === 'running' ? (
            <Button kind="secondary" title="Avbryt Garmin-hämtningen" onPress={() => { stop.current = true; }} />
          ) : (
            <Button big title={`Importera ${parsed.days.length - overlap} dagar`} onPress={run} />
          )
        }
      >
        {progress ? <Card tone="accent"><P>{progress}</P></Card> : null}
        {error ? <Card tone="red"><P>{error}</P></Card> : null}

        <Section title="Filerna">
          <Card>
            {parsed.files.map((f) => (
              <P key={f.name} style={{ marginBottom: space.xs }}>
                {f.days ? `${f.name}: ${f.days} ifyllda dagar, ${formatDateSv(f.from!)} till ${formatDateSv(f.to!)}.` : `${f.name}: inga ifyllda dagar.`}
              </P>
            ))}
            <P style={{ marginTop: space.s, fontWeight: '600' }}>
              {`${parsed.days.length} dagar från ${formatDateSv(period.from)} till ${formatDateSv(period.to)}.`}
            </P>
            {overlap ? <P muted>{`${overlap} av dagarna finns redan i Dagsljus. De lämnas som de är.`}</P> : null}
            {parsed.duplicates ? <P muted>{`${parsed.duplicates} datum fanns i flera filer. Det första användes.`}</P> : null}
          </Card>
        </Section>

        <Section title="Så översätts dagarna">
          <Card>
            <P>• Anteckningen blir dagens text. Akutregeln körs på varje anteckning.</P>
            <P>{`• Humöret blir stämning 1–10. Balanserad blir ${MOOD_BALANCED}. Lågt humör blir ${LOW_VALUES}, efter dagbokens tre nivåer. Högt humör blir ${HIGH_VALUES}. Ett lågt värde går före ett högt samma dag.`}</P>
            <P>• Medicin NEJ räknas som medicin inte tagen. Två kvällar i rad ger en poäng, som vanligt.</P>
            <P>• Alkohol JA räknas som ja på frågan om alkohol i går, dagen efter.</P>
            <P>• Sömn tas från Garmin, annars från anteckningens rad som börjar med ”Sömn:”.</P>
            <P>• Energi och klockslag finns inte i dagboken och lämnas tomma.</P>
            <P muted style={{ marginTop: space.s }}>
              Nivån räknas i appen med samma regler som en vanlig kväll. Ingenting skickas till någon språkmodell. Alla
              ursprungliga värden sparas på dagen.
            </P>
          </Card>
        </Section>

        <Section title="Koppla dagbokens punkter till dina tecken">
          <P muted style={{ marginBottom: space.m }}>
            En punkt ger poäng bara om du kopplar den till ett av dina tecken. Appen har föreslagit kopplingar där orden
            liknar varandra. Kontrollera varje rad.
          </P>
          {signs.length === 0 ? <Card tone="yellow"><P>Du har inga tecken i krisplanen än. Alla punkter ignoreras då.</P></Card> : null}
          {counts.map((c) => (
            <Card key={c.signal}>
              <Text style={[type.body, { fontWeight: '600' }]}>{c.signal}</Text>
              <Text style={[type.small, { marginBottom: space.s }]}>{`${c.days} dagar`}</Text>
              <Row>
                <Chip label="Ignorera" selected={!mapping[c.signal]} onPress={() => setMapping({ ...mapping, [c.signal]: null })} />
                {signs.map((s) => (
                  <Chip
                    key={s.id}
                    label={`${s.text}${s.kind === 'serious' ? ' (allvarligt)' : ''}`}
                    selected={mapping[c.signal] === s.id}
                    onPress={() => setMapping({ ...mapping, [c.signal]: s.id })}
                  />
                ))}
              </Row>
            </Card>
          ))}
        </Section>

        <Section title="Garmin för samma period">
          <Card>
            {garminConnected ? (
              <>
                <P>
                  {`Appen hämtar sömn och stress för ${formatDateSv(period.from)} till ${formatDateSv(period.to)}, nyast först, 28 dagar i taget. Det kan ta några minuter. Stoppar Garmin fortsätter hämtningen där den slutade nästa gång.`}
                </P>
                {saved?.fetchedDays ? <P muted style={{ marginTop: space.xs }}>{`${saved.fetchedDays} dagar är redan hämtade.`}</P> : null}
                <Row style={{ marginTop: space.s }}>
                  <Chip label="Hämta från Garmin" selected={withGarmin} onPress={() => setWithGarmin(true)} />
                  <Chip label="Utan Garmin" selected={!withGarmin} onPress={() => setWithGarmin(false)} />
                </Row>
              </>
            ) : (
              <P>Garmin är inte anslutet. Anslut under Inställningar först om du vill ha sömn och stress för perioden.</P>
            )}
          </Card>
        </Section>
      </Screen>
    );
  }

  return (
    <Screen title={`Importera från ${SOURCE_NAME}`} back>
      <P style={{ marginBottom: space.m }}>
        Välj årsrapporterna från {SOURCE_NAME} (CSV-filer). Du kan välja flera på en gång. Filerna läses här, och du ser
        och kopplar allt innan något sparas. Importen kan tas bort i sin helhet efteråt.
      </P>
      {error ? <Card tone="red"><P>{error}</P></Card> : null}
      <Button big title="Välj filer" onPress={pick} />

      {imports.length ? (
        <Section title="Tidigare importer">
          {imports.map((r) => (
            <Card key={r.id}>
              <P>{`${r.days} dagar, ${formatDateSv(r.from)} till ${formatDateSv(r.to)}. Importerad ${formatDateSv(r.at.slice(0, 10))}.`}</P>
              <Button kind="danger" title="Ta bort importen" onPress={() => remove(r.id, r.days)} />
            </Card>
          ))}
        </Section>
      ) : null}
      <P muted style={{ marginTop: space.l }}>
        Färgen för en importerad dag räknas med samma regler som i dag. Den kan skilja sig från hur dagen kändes då.
      </P>
    </Screen>
  );
}
