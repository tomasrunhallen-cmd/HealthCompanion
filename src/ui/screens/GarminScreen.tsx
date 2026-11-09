import React, { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { addDays, formatDateSv, formatTime, toDateKey } from '../../core/analysis/dates';
import { GARMIN_KEY_PAGE } from '../../garmin/client';
import { secretsPersist } from '../../platform/secrets';
import { connectGarmin, disconnectGarmin, syncGarmin } from '../../services/garmin';
import { afterSync } from '../../services/remeasure';
import { backfillGarmin, backfillState } from '../../services/garminHistory';
import { Button, Card, Field, P, Row, Screen, Section } from '../components';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

function dec(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function sameDay(iso: string): boolean {
  return toDateKey(new Date(iso)) === toDateKey(new Date());
}

export function GarminScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const status = repo.garminStatus();
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'sync' | 'history' | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const stop = useRef(false);

  const connect = async () => {
    setBusy('connect');
    try {
      const res = await connectGarmin(repo, key);
      if (!res.ok) return dialog.info('Det gick inte att ansluta', res.error ?? 'Okänt fel.');
      setKey('');
      setReplacing(false);
      const nights = res.days.filter((d) => d.sleepHours != null).length;
      await dialog.info('Anslutet', `Hämtade ${nights} nätters sömn och ${res.days.filter((d) => d.stressAvg != null).length} dagars stress. Nyckeln ligger i telefonens nyckelring.`);
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    try {
      const res = await syncGarmin(repo);
      if (!res.ok && res.error) await dialog.info('Hämtningen misslyckades', res.error);
      else if (res.ok) await afterSync(repo);
    } finally {
      setBusy(null);
    }
  };

  // A year back, for the trend over 6 months and a year. Days already fetched are not asked again.
  const fetchYear = async () => {
    stop.current = false;
    setBusy('history');
    const today = toDateKey(new Date());
    try {
      const r = await backfillGarmin(repo, addDays(today, -365), today, {
        cancelled: () => stop.current,
        onProgress: (p) => setHistory(p.state.nextEnd ? `Hämtar bakåt till ${formatDateSv(p.state.nextEnd)}…` : null),
      });
      setHistory(
        r.error ? r.error
          : !r.done ? 'Avbrutet. Hämtningen fortsätter där den slutade nästa gång.'
            : r.state.oldestWithData ? `Klart. Garmin har värden från ${formatDateSv(r.state.oldestWithData)}.` : 'Klart. Garmin hade inga äldre värden.',
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    const ok = await dialog.confirm({
      title: 'Koppla bort Garmin?',
      message: 'Nyckeln raderas från telefonen. Redan hämtade värden ligger kvar och används i baslinjen. Sömn tas då ur anteckningen igen.',
      confirmLabel: 'Koppla bort',
      danger: true,
    });
    if (ok) await disconnectGarmin(repo);
  };

  const today = toDateKey(new Date());
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i)).map((d) => ({ date: d, g: repo.garminDay(d) }));
  const showKeyField = !status.connected || replacing;

  return (
    <Screen title="Garmin" back>
      <Card tone={status.connected ? (status.lastError ? 'yellow' : 'green') : undefined}>
        <Text style={type.h2}>{status.connected ? 'Ansluten' : 'Inte ansluten'}</Text>
        <P muted style={{ marginTop: space.xs }}>
          {status.connected
            ? status.lastSyncAt
              ? `Senast hämtat ${sameDay(status.lastSyncAt) ? `i dag ${formatTime(status.lastSyncAt)}` : formatDateSv(toDateKey(new Date(status.lastSyncAt)))}. Appen hämtar när den öppnas och precis före kvällens avstämning.`
              : 'Inget hämtat ännu.'
            : 'Utan Garmin tas sömnen ur anteckningen, till exempel ”sov sex timmar”, och markeras som skattad. Stress mäts inte.'}
        </P>
        {status.lastError ? <P style={{ marginTop: space.s, color: colors.danger }}>{status.lastError}</P> : null}
      </Card>

      {showKeyField ? (
        <Section title={replacing ? 'Ny nyckel' : 'Anslut med din egen nyckel'}>
          <Card>
            <P>1. Logga in på Garmin Connect på webben och öppna sidan för Personal API-nyckel.</P>
            <Pressable onPress={() => Linking.openURL(GARMIN_KEY_PAGE)} accessibilityRole="link" style={{ marginVertical: space.xs }}>
              <Text style={{ color: colors.accent, fontWeight: '600' }}>Öppna Garmin Connect ›</Text>
            </Pressable>
            <P>2. Skapa en nyckel, godkänn villkoren och välj hur länge den ska gälla. Längst är ett år.</P>
            <P>3. Kopiera nyckeln och klistra in den här. Garmin visar den bara en gång.</P>
            <P muted style={{ marginTop: space.s }}>
              Appen hämtar sömn, stress och Body Battery från ditt eget konto. Inget av det du skriver skickas till Garmin.
              Garmins Personal API är till för personligt bruk av den egna datan.
            </P>
          </Card>
          <Field
            label="GARMIN-NYCKEL"
            value={key}
            onChangeText={setKey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Klistra in nyckeln"
            hint={secretsPersist ? 'Sparas i telefonens nyckelring, bara om Garmin godtar den.' : 'I webbförhandsvisningen sparas nyckeln bara tills sidan laddas om.'}
          />
          <Button title="Anslut" onPress={connect} busy={busy === 'connect'} disabled={!key.trim()} />
          {replacing ? <Button kind="ghost" title="Avbryt" onPress={() => { setReplacing(false); setKey(''); }} /> : null}
        </Section>
      ) : (
        <Section title="Hämtning">
          <Button title="Hämta nu" onPress={syncNow} busy={busy === 'sync'} />
          <Button kind="secondary" title="Byt nyckel" onPress={() => setReplacing(true)} />
        </Section>
      )}

      <Section title="Senaste veckan">
        <Card>
          {days.map(({ date, g }) => (
            <View key={date} style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{formatDateSv(date)}</Text>
              <Text style={type.small}>
                {g
                  ? [
                      g.sleepHours != null ? `Sömn ${dec(g.sleepHours)} h${g.sleepStart ? `, somnade ${g.sleepStart}` : ''}` : 'Sömn saknas',
                      g.stressAvg != null ? `stress ${g.stressAvg}` : null,
                      g.bodyBatteryWake != null ? `Body Battery ${g.bodyBatteryWake}` : null,
                    ].filter(Boolean).join(', ')
                  : 'Inga värden'}
              </Text>
            </View>
          ))}
          <P muted style={{ marginTop: space.s }}>
            Sömnen hör till morgonen du vaknade. Värdena skickas med som bakgrund när din språkmodell gör kvällens bedömning.
          </P>
        </Card>
      </Section>

      {status.connected ? (
        <Section title="Äldre värden">
          <Card>
            <P>Trenden över 6 månader och ett år använder Garmins värden för hela perioden. Appen sparar alla dagar den hämtat.</P>
            <P muted style={{ marginTop: space.xs }}>
              {history ?? (backfillState(repo)?.oldestWithData ? `Hämtat bakåt till ${formatDateSv(backfillState(repo)!.oldestWithData!)}.` : 'Hämta ett år bakåt en gång. Det tar en minut eller två.')}
            </P>
            {busy === 'history'
              ? <Button kind="ghost" title="Avbryt" onPress={() => { stop.current = true; }} />
              : <Button kind="secondary" title="Hämta ett år bakåt" hint="Hämtar sömn och stress från Garmin för det senaste året" onPress={fetchYear} />}
          </Card>
        </Section>
      ) : null}

      {status.connected ? (
        <Section title="Koppla bort">
          <Row>
            <Button kind="danger" title="Koppla bort Garmin" onPress={disconnect} />
          </Row>
        </Section>
      ) : null}
    </Screen>
  );
}
