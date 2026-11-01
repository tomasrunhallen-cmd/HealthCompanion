import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { createCompleter } from '../../core/llm/complete';
import { PROVIDER_ORDER, PROVIDERS, normalizeBaseUrl, type ProviderId } from '../../adapter/providers';
import { eveningDateKey } from '../../core/analysis/dates';
import { destinationKey, estimateMonthlyCost, hasConsent, importModelOf, isLocalDestination } from '../../llm/config';
import { deleteSecret, getSecret, secretsPersist, setSecret } from '../../platform/secrets';
import { buildAdapter, differingCases, LLM_KEY_NAME, runModelTest, type CaseResult, type ModelTestReport } from '../../services/llm';
import { Button, Card, Chip, Field, P, Row, Screen, Section } from '../components';
import { useDialog, useRepo } from '../state';
import { colors, LEVEL_TEXT, space, type } from '../theme';

function parsePrice(s: string): number | null {
  const v = Number(s.replace(',', '.').trim());
  return s.trim() && Number.isFinite(v) && v >= 0 ? v : null;
}

function formatTokens(n: number): string {
  return n.toLocaleString('sv-SE');
}

function formatKronor(v: number): string {
  return v < 1 ? `${v.toFixed(2).replace('.', ',')} kr` : `${Math.round(v * 10) / 10} kr`.replace('.', ',');
}

/** One line under each test case: what it gave against the reference, or why it got nothing. */
function caseLine(c: CaseResult): string {
  const via = c.akut ? ' Avgjort av akutregeln, utan modellen.' : '';
  if (c.error && c.got) return `${c.error}${via}`;
  if (!c.got) return c.error ?? 'Inget svar.';
  const gave = `Gav ${LEVEL_TEXT[c.got].toLowerCase()}`;
  return c.ok ? `${gave}, som referenssvaret.${via}` : `${gave}, referenssvaret är ${LEVEL_TEXT[c.expected].toLowerCase()}.${via}`;
}

export function LlmSettingsScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const saved = repo.llmConfig();

  const [provider, setProvider] = useState<ProviderId>(saved.provider ?? 'mistral');
  const [model, setModel] = useState(saved.model || (PROVIDERS[saved.provider ?? 'mistral'].modelSuggestions[0] ?? ''));
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [importModel, setImportModel] = useState(saved.importModel ?? '');
  const [keyInput, setKeyInput] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [replaceKey, setReplaceKey] = useState(false);
  const [consented, setConsented] = useState<string | null>(saved.consentFor);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<{ sig: string; r: ModelTestReport } | null>(null);
  const [priceIn, setPriceIn] = useState(saved.priceInPerMillion?.toString().replace('.', ',') ?? '');
  const [priceOut, setPriceOut] = useState(saved.priceOutPerMillion?.toString().replace('.', ',') ?? '');

  useEffect(() => {
    getSecret(LLM_KEY_NAME).then((k) => setSavedKey(!!k));
  }, []);

  const info = PROVIDERS[provider];
  const sameProviderAsSaved = saved.provider === provider;
  const usingSavedKey = savedKey && sameProviderAsSaved && !replaceKey;
  const local = isLocalDestination(provider, baseUrl);
  const dest = destinationKey(provider, baseUrl);
  // A test result only counts for exactly the settings it was run with.
  const sig = `${dest}|${model.trim()}|${usingSavedKey ? 'saved' : keyInput.trim()}`;
  const currentReport = report?.sig === sig ? report.r : null;

  const missing = useMemo(() => {
    if (info.needsBaseUrl && !/^https?:\/\/.+/i.test(baseUrl.trim())) return 'Skriv adressen, till exempel http://192.168.1.20:11434/v1.';
    if (info.keyRequired && !usingSavedKey && !keyInput.trim()) return 'Klistra in din nyckel.';
    if (!model.trim()) return 'Skriv eller välj ett modellnamn.';
    return null;
  }, [info, baseUrl, usingSavedKey, keyInput, model]);

  const pickProvider = (p: ProviderId) => {
    setProvider(p);
    setReplaceKey(false);
    setKeyInput('');
    if (p !== saved.provider) setModel(PROVIDERS[p].modelSuggestions[0] ?? '');
    else setModel(saved.model);
  };

  const askConsent = async (): Promise<boolean> => {
    if (consented === dest) return true;
    const ok = await dialog.confirm(
      local
        ? {
            title: 'Din egen server',
            message: `Adressen ${normalizeBaseUrl(baseUrl)} ligger på ditt eget nätverk. Texten lämnar inte dina egna enheter. Den rensas ändå från namn och nummer först.`,
            confirmLabel: 'Fortsätt',
          }
        : {
            title: `Text skickas till ${provider === 'openai-compatible' ? normalizeBaseUrl(baseUrl) : info.label}`,
            message:
              `Rensad text, utan namn, nummer och adresser, skickas med din egen nyckel. ` +
              `Leverantörens egna villkor för lagring och träning gäller. Appen kan inte se eller lova hur texten lagras där. ` +
              `${info.termsUrl ? 'Villkoren finns under länken på den här sidan. ' : ''}` +
              `Testet skickar bara appens påhittade testfall, ingen av dina anteckningar.`,
            confirmLabel: 'Jag förstår, fortsätt',
          },
    );
    if (ok) setConsented(dest);
    return ok;
  };

  const runTest = async () => {
    if (missing) return dialog.info('Något saknas', missing);
    if (!(await askConsent())) return;
    setBusy(true);
    setProgress('Kör testfallen…');
    try {
      const key = usingSavedKey ? await getSecret(LLM_KEY_NAME) : keyInput.trim() || null;
      const adapter = buildAdapter({ provider, model, baseUrl }, key, { browser: Platform.OS === 'web' });
      // Test calls cost tokens too, so they are counted; they are not "the last assessment".
      const completer = createCompleter(adapter, { onUsage: (u) => void repo.recordUsage(eveningDateKey(new Date()), u) });
      const r = await runModelTest(
        completer,
        adapter.model,
        (done, total) => setProgress(done < total ? `Kör testfall ${done + 1} av ${total}…` : null),
        repo.contextEntries(),
      );
      setReport({ sig, r });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const save = async () => {
    const r = currentReport;
    if (!r) return;
    // A model is approved only when every case gave the reference level.
    if (!r.approved) {
      await dialog.info(
        'Modellen är inte godkänd',
        `${r.total - r.passed} av ${r.total} testfall gav en annan nivå än referenssvaret. Appen fortsätter med det du hade förut.`,
      );
      return;
    }
    if (!usingSavedKey) {
      if (keyInput.trim()) await setSecret(LLM_KEY_NAME, keyInput.trim());
      else await deleteSecret(LLM_KEY_NAME);
    }
    await repo.updateLlmConfig({
      provider,
      model: model.trim(),
      baseUrl: provider === 'openai-compatible' ? normalizeBaseUrl(baseUrl) : '',
      consentFor: dest,
      lastTest: {
        at: new Date().toISOString(), provider, model: model.trim(),
        baseUrl: normalizeBaseUrl(baseUrl), passed: r.passed, total: r.total,
      },
    });
    setKeyInput('');
    setReplaceKey(false);
    setSavedKey(!!(usingSavedKey || keyInput.trim()));
    await dialog.info('Sparat', `Kvällens bedömning använder nu ${model.trim()}. Nyckeln ligger i telefonens nyckelring och visas inte igen.`);
  };

  const disconnect = async () => {
    const ok = await dialog.confirm({
      title: 'Sluta använda språkmodell?',
      message: 'Nyckeln raderas från telefonen. Bedömningen görs med ordmatchning på telefonen och ingen text skickas någonstans.',
      confirmLabel: 'Koppla bort',
      danger: true,
    });
    if (!ok) return;
    await deleteSecret(LLM_KEY_NAME);
    await repo.updateLlmConfig({ provider: null, consentFor: null, lastTest: null });
    setSavedKey(false);
    setConsented(null);
    setReport(null);
  };

  const savePrices = (pin: string, pout: string) =>
    repo.updateLlmConfig({ priceInPerMillion: parsePrice(pin), priceOutPerMillion: parsePrice(pout) });

  const cost = estimateMonthlyCost(repo.usageLog(), eveningDateKey(new Date()), repo.llmConfig());
  const active = saved.provider && hasConsent(saved);

  return (
    <Screen title="Språkmodell" back>
      <Card tone={active ? 'green' : undefined}>
        <Text style={type.h2}>{active ? `${PROVIDERS[saved.provider!].label}: ${saved.model}` : 'Ingen språkmodell'}</Text>
        <P muted style={{ marginTop: space.xs }}>
          {active
            ? `Tolkar din anteckning mot dina tecken. Nivån räknas alltid i appen.${saved.lastTest ? ` Senaste test: ${saved.lastTest.passed} av ${saved.lastTest.total}.` : ''}`
            : 'Appen jämför din anteckning med dina tecken genom ordmatchning på telefonen. Ingen text lämnar telefonen.'}
        </P>
      </Card>

      <Section title="Leverantör">
        <Row style={{ gap: 6 }}>
          {PROVIDER_ORDER.map((p) => (
            <Chip key={p} label={PROVIDERS[p].label} selected={provider === p} onPress={() => pickProvider(p)} />
          ))}
        </Row>
        {info.termsUrl ? (
          <Pressable onPress={() => Linking.openURL(info.termsUrl!)} accessibilityRole="link" style={{ marginTop: space.s }}>
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Läs {info.label}s villkor ›</Text>
          </Pressable>
        ) : null}
      </Section>

      <Section title="Inställningar">
        {info.needsBaseUrl ? (
          <Field
            label="ADRESS (BAS-URL)"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="http://192.168.1.20:11434/v1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint={baseUrl.trim() ? (local ? 'Din egen server: texten lämnar inte dina enheter.' : 'Adressen ligger utanför ditt nätverk.') : undefined}
          />
        ) : null}

        {usingSavedKey ? (
          <Card>
            <P>Nyckeln är sparad i telefonens nyckelring. Den visas inte igen.</P>
            <Button kind="secondary" title="Byt nyckel" onPress={() => setReplaceKey(true)} />
          </Card>
        ) : (
          <Field
            label={info.keyRequired ? 'NYCKEL' : 'NYCKEL (OM SERVERN KRÄVER EN)'}
            value={keyInput}
            onChangeText={setKeyInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Klistra in nyckeln"
            hint={info.keyHelp + (secretsPersist ? '' : ' I webbförhandsvisningen sparas nyckeln bara tills sidan laddas om.')}
          />
        )}

        <Field
          label="MODELL"
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Modellnamn"
          hint="Fritext. Byt när en bättre modell kommer; testfallen körs innan bytet sparas."
        />
        {info.modelSuggestions.length ? (
          <Row style={{ gap: 6, marginTop: -space.s, marginBottom: space.l }}>
            {info.modelSuggestions.map((m) => (
              <Chip key={m} label={m} selected={model.trim() === m} onPress={() => setModel(m)} />
            ))}
          </Row>
        ) : null}

        <Button title="Testa modellen" onPress={runTest} busy={busy} disabled={busy} />
        {progress ? <P muted style={{ textAlign: 'center' }}>{progress}</P> : null}
        {missing && !busy ? <P muted>{missing}</P> : null}
      </Section>

      {currentReport ? (
        <Section title={currentReport.approved ? `Godkänd: alla ${currentReport.total} testfall gav rätt nivå` : `Inte godkänd: ${currentReport.passed} av ${currentReport.total} testfall gav rätt nivå`}>
          <Card tone={currentReport.approved ? 'green' : 'yellow'}>
            {!currentReport.approved ? (
              <P style={{ marginBottom: space.s }}>
                En ny modell godkänns bara när alla fall ger samma nivå som referenssvaren. Fallen som skilde sig står först.
              </P>
            ) : null}
            {[...differingCases(currentReport), ...currentReport.cases.filter((c) => c.ok)].map((c) => (
              <View key={c.id} style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
                <Text style={[type.body, { fontWeight: '600' }]}>{c.ok ? '✓' : '✗'} {c.name}</Text>
                <Text style={type.small}>{caseLine(c)}</Text>
              </View>
            ))}
            {currentReport.cases.length < currentReport.total ? (
              <P muted style={{ marginTop: space.s }}>Testet avbröts efter första felet eftersom det gäller alla fall.</P>
            ) : null}
            <P muted style={{ marginTop: space.s }}>
              Prompt analys version {currentReport.promptVersion}, testfall version {currentReport.suiteVersion}.
            </P>
          </Card>
          <Button title={`Spara ${model.trim()}`} onPress={save} disabled={!currentReport.approved} />
        </Section>
      ) : null}

      {active ? (
        <Section title="Krisplansimporten">
          <Card>
            <P muted>
              Appen sorterar krisplanens rader efter rubrikerna själv. Bara rader under rubriker den inte känner igen skickas,
              rensade, en rubrik i taget. Lämna fältet tomt för att använda samma modell som kvällens bedömning.
            </P>
            <Field
              label="MODELL FÖR IMPORTEN"
              value={importModel}
              onChangeText={setImportModel}
              onBlur={() => repo.updateLlmConfig({ importModel: importModel.trim() })}
              placeholder={saved.model}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Modell för krisplansimporten"
              hint={`${PROVIDERS[saved.provider!].label}, samma nyckel. Används nu: ${importModelOf(saved)}.`}
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Kostnad">
        <Card>
          <P>
            Senaste 30 dagarna: {formatTokens(cost.inputTokens)} tokens in och {formatTokens(cost.outputTokens)} ut.
          </P>
          <P style={{ marginTop: space.xs, fontWeight: '700' }}>
            {cost.kronor == null
              ? 'Fyll i priserna nedan för att se en uppskattning.'
              : `Uppskattad månadskostnad: ${formatKronor(cost.kronor)}`}
          </P>
          <P muted style={{ marginTop: space.s }}>
            Appen har inga inbyggda priser. Skriv in leverantörens aktuella pris i kronor per miljon tokens.
          </P>
          <Row style={{ marginTop: space.m, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}>
              <Field label="KR / MILJON IN" value={priceIn} keyboardType="decimal-pad"
                onChangeText={setPriceIn} onBlur={() => savePrices(priceIn, priceOut)} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="KR / MILJON UT" value={priceOut} keyboardType="decimal-pad"
                onChangeText={setPriceOut} onBlur={() => savePrices(priceIn, priceOut)} />
            </View>
          </Row>
        </Card>
      </Section>

      {saved.provider ? (
        <Section title="Koppla bort">
          <Card>
            <P muted>Raderar nyckeln och går tillbaka till ordmatchning på telefonen.</P>
            <Button kind="danger" title="Använd ingen språkmodell" onPress={disconnect} />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
