import React, { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { decryptBackup, encryptBackup, type BackupFile } from '../../backup/crypto';
import { pickImportFile, randomBytes, saveExportFile } from '../../platform/files';
import { clearPin, lockSupport, setPin, usesPin, type LockSupport } from '../../platform/lock';
import { cancelHint, cancelReminder, reminderSupported, reminderViaCalendar, scheduleReminder } from '../../platform/reminder';
import type { ExportData } from '../../storage/repository';
import { toDateKey } from '../../analysis/dates';
import { PROVIDERS } from '../../adapter/providers';
import { hasConsent } from '../../llm/config';
import { deleteSecret } from '../../platform/secrets';
import { LLM_KEY_NAME } from '../../services/llm';
import { GARMIN_KEY_NAME } from '../../services/garmin';
import { signOutUser } from '../../cloud/firebase';
import { Button, Card, Field, P, Row, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <Text style={[type.body, { flex: 1, fontWeight: '600' }]}>{props.label}</Text>
      <Switch
        accessibilityLabel={props.label}
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </Row>
  );
}

export function SettingsScreen() {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const s = repo.settings();
  const llm = repo.llmConfig();
  const garmin = repo.garminStatus();
  const [lock, setLock] = useState<LockSupport | null>(null);
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [importPw, setImportPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    lockSupport().then(setLock);
  }, []);

  const savePin = async () => {
    try {
      await setPin(newPin);
      setNewPin('');
      setLock(await lockSupport());
      await repo.updateSettings({ appLockEnabled: true });
      await dialog.info('Koden är sparad', 'Appen frågar efter koden när den öppnas och när du kommer tillbaka till den.');
    } catch (e) {
      await dialog.info('Koden sparades inte', (e as Error).message);
    }
  };

  const removePin = async () => {
    await clearPin();
    setLock(await lockSupport());
    await repo.updateSettings({ appLockEnabled: false });
  };

  const applyReminder = async (enabled: boolean, hour: number, minute: number) => {
    await repo.updateSettings({ reminderEnabled: enabled, reminderHour: hour, reminderMinute: minute });
    if (!enabled) {
      await cancelReminder();
      setReminderMsg(cancelHint);
      return;
    }
    const res = await scheduleReminder(hour, minute);
    setReminderMsg(res.message);
    if (!res.ok) await repo.updateSettings({ reminderEnabled: false });
  };

  const shiftTime = (minutes: number) => {
    const total = (s.reminderHour * 60 + s.reminderMinute + minutes + 24 * 60) % (24 * 60);
    const [hour, minute] = [Math.floor(total / 60), total % 60];
    // On the web the time only takes effect when the calendar event is added again.
    if (reminderViaCalendar) repo.updateSettings({ reminderHour: hour, reminderMinute: minute });
    else applyReminder(s.reminderEnabled, hour, minute);
  };

  const doExport = async () => {
    if (pw.length < 8) return dialog.info('Lösenordet är för kort', 'Välj ett lösenord med minst 8 tecken.');
    if (pw !== pw2) return dialog.info('Lösenorden skiljer sig', 'Skriv samma lösenord två gånger.');
    setBusy('export');
    try {
      const file = await encryptBackup(JSON.stringify(repo.exportData()), pw, randomBytes);
      await saveExportFile(`dagsljus-${toDateKey(new Date())}.json`, JSON.stringify(file));
      setPw('');
      setPw2('');
    } catch (e) {
      await dialog.info('Exporten misslyckades', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    const text = await pickImportFile();
    if (!text) return;
    setBusy('import');
    try {
      const file = JSON.parse(text) as BackupFile;
      const data = JSON.parse(await decryptBackup(file, importPw)) as ExportData;
      const ok = await dialog.confirm({
        title: 'Ersätta all data?',
        message: `Exporten är från ${data.exportedAt.slice(0, 10)}. Allt som finns i appen nu ersätts.`,
        confirmLabel: 'Ersätt allt',
        danger: true,
      });
      if (!ok) return;
      await repo.importData(data);
      setImportPw('');
      await dialog.info('Klart', 'Datan är återställd.');
    } catch (e) {
      await dialog.info('Importen misslyckades', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doWipe = async () => {
    const ok = await dialog.confirm({
      title: 'Radera allt?',
      message: 'Krisplan, anteckningar, bedömningar, inställningar, Garmin-värden och nycklarna till språkmodellen och Garmin raderas från telefonen. Det går inte att ångra.',
      confirmLabel: 'Radera allt',
      danger: true,
    });
    if (!ok) return;
    await cancelReminder();
    await deleteSecret(LLM_KEY_NAME);
    await deleteSecret(GARMIN_KEY_NAME);
    await repo.wipe();
    nav.reset();
  };

  return (
    <Screen title="Inställningar" back>
      <Section title="Påminnelse">
        <Card>
          {reminderViaCalendar ? (
            <Text style={[type.body, { fontWeight: '600' }]}>Påminn mig på kvällen via telefonens kalender</Text>
          ) : (
            <Toggle
              label="Påminn mig på kvällen"
              value={s.reminderEnabled}
              disabled={!reminderSupported}
              onChange={(v) => applyReminder(v, s.reminderHour, s.reminderMinute)}
            />
          )}
          <Row style={{ marginTop: space.m }}>
            <Button kind="secondary" title="−15 min" onPress={() => shiftTime(-15)} />
            <Text style={[type.h2, { minWidth: 80, textAlign: 'center' }]}>{pad(s.reminderHour)}:{pad(s.reminderMinute)}</Text>
            <Button kind="secondary" title="+15 min" onPress={() => shiftTime(15)} />
          </Row>
          {reminderViaCalendar ? (
            <Button title="Lägg till i kalendern" onPress={() => applyReminder(true, s.reminderHour, s.reminderMinute)} />
          ) : null}
          <P muted>
            {reminderMsg ?? (reminderViaCalendar
              ? 'Webbappen kan inte skicka notiser själv. En händelse som upprepas varje kväll i din kalender påminner dig i stället. Bara klockslaget lämnar telefonen.'
              : reminderSupported
                ? 'En lokal notis på din telefon. Den skickas aldrig till någon annan.'
                : 'Påminnelser finns bara i appen på telefonen.')}
          </P>
        </Card>
      </Section>

      <Section title="Applås">
        <Card>
          <Toggle
            label={usesPin ? 'Lås med kod' : 'Lås med Face ID, fingeravtryck eller kod'}
            value={s.appLockEnabled && !!lock?.available}
            disabled={!lock?.available}
            onChange={(v) => repo.updateSettings({ appLockEnabled: v })}
          />
          {lock?.reason ? <P muted style={{ marginTop: space.s }}>{lock.reason}</P> : null}
          {usesPin ? (
            <View style={{ marginTop: space.m }}>
              <Field
                label={lock?.available ? 'NY KOD (4–8 SIFFROR)' : 'KOD (4–8 SIFFROR)'}
                value={newPin}
                onChangeText={(t) => setNewPin(t.replace(/\D/g, '').slice(0, 8))}
                secureTextEntry
                keyboardType="number-pad"
                placeholder="4–8 siffror"
              />
              <Button kind="secondary" title={lock?.available ? 'Byt kod' : 'Spara kod'} onPress={savePin} disabled={newPin.length < 4} />
              {lock?.available ? <Button kind="ghost" title="Ta bort koden" onPress={removePin} /> : null}
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="Språkmodell">
        <Card>
          <P>
            {llm.provider && hasConsent(llm)
              ? `${PROVIDERS[llm.provider].label}, ${llm.model}. Rensad text skickas dit vid kvällens bedömning.`
              : 'Ingen språkmodell är kopplad. Appen jämför din anteckning med dina tecken genom ordmatchning på telefonen.'}
          </P>
          <Button kind="secondary" title={llm.provider ? 'Ändra språkmodell' : 'Koppla en språkmodell'} onPress={() => nav.push({ name: 'llm' })} />
        </Card>
      </Section>

      <Section title="Garmin">
        <Card>
          <P>
            {garmin.connected
              ? `Ansluten. Sömn och stress hämtas från ditt Garmin-konto.${garmin.lastError ? ` Senaste hämtningen misslyckades: ${garmin.lastError}` : ''}`
              : 'Inte ansluten. Sömnen tas ur anteckningen och stress mäts inte.'}
          </P>
          <Button kind="secondary" title={garmin.connected ? 'Ändra Garmin' : 'Anslut Garmin'} onPress={() => nav.push({ name: 'garmin' })} />
        </Card>
      </Section>

      <Section title="Namn att rensa bort">
        <Card>
          <P muted>
            Partner, föräldrar, vårdkontakt, kollegor. Namnen byts mot [NAMN] innan text skickas till en språkmodell.
          </P>
          <Row style={{ marginTop: space.s, gap: 6 }}>
            {s.scrubNames.length === 0 ? <P muted>Listan är tom.</P> : null}
            {s.scrubNames.map((n) => (
              <Pressable
                key={n}
                onPress={() => repo.updateSettings({ scrubNames: s.scrubNames.filter((x) => x !== n) })}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
                accessibilityLabel={`Ta bort ${n}`}
              >
                <Text style={type.body}>{n} ✕</Text>
              </Pressable>
            ))}
          </Row>
          <View style={{ marginTop: space.m }}>
            <Field value={newName} onChangeText={setNewName} placeholder="Lägg till namn" autoCapitalize="words" />
            <Button
              kind="secondary"
              title="Lägg till"
              disabled={!newName.trim()}
              onPress={() => {
                const n = newName.trim();
                if (n && !s.scrubNames.includes(n)) repo.updateSettings({ scrubNames: [...s.scrubNames, n] });
                setNewName('');
              }}
            />
          </View>
        </Card>
      </Section>

      {repo.storageInfo().kind === 'cloud' ? (
        <Section title="Konto">
          <Card>
            <P muted>{repo.storageInfo().detail}</P>
            <Button kind="secondary" title="Logga ut" onPress={async () => {
              const ok = await dialog.confirm({
                title: 'Logga ut?',
                message: 'Din data ligger kvar i Firebase. Du loggar in med e-post och lösenord nästa gång. Applåsets kod tas bort från den här webbläsaren.',
                confirmLabel: 'Logga ut',
              });
              if (!ok) return;
              await clearPin();
              await signOutUser();
            }} />
          </Card>
        </Section>
      ) : null}

      <Section title="Exportera allt">
        <Card>
          <P muted>
            En krypterad fil med all din data. Du väljer själv var den sparas. Utan lösenordet går filen inte att öppna.
          </P>
          <View style={{ marginTop: space.m }}>
            <Field label="LÖSENORD (MINST 8 TECKEN)" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" />
            <Field label="SAMMA LÖSENORD IGEN" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" />
            <Button title="Exportera allt" onPress={doExport} busy={busy === 'export'} />
          </View>
        </Card>
      </Section>

      <Section title="Återställ från export">
        <Card>
          <Field label="EXPORTENS LÖSENORD" value={importPw} onChangeText={setImportPw} secureTextEntry autoCapitalize="none" />
          <Button kind="secondary" title="Välj exportfil" disabled={!importPw} onPress={doImport} busy={busy === 'import'} />
        </Card>
      </Section>

      <Section title="Radera allt">
        <Card>
          <P muted>Tar bort all data, databasnyckeln och nycklarna till språkmodellen och Garmin från telefonen.</P>
          <Button kind="danger" title="Radera allt" onPress={doWipe} />
        </Card>
      </Section>
    </Screen>
  );
}
