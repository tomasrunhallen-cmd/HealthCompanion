import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cloudDocsFor, signOutUser, type CloudUser } from '../../cloud/firebase';
import { MIN_PASSWORD_LENGTH, WrongPasswordError, type Vault } from '../../cloud/vault';
import type { MigrationReport } from '../../storage/cloudBackend';
import {
  commitVault, prepareVault, readVaultState, unlockVault, type Prepared, type VaultState,
} from '../../services/vaultFlow';
import { Button, Card, Field, P } from '../components';
import { colors, space, type } from '../theme';

const COLLECTION_TEXT: Record<string, string> = {
  entries: 'anteckningar', assessments: 'bedömningar', grund: 'poster i krisplanen och grunden', profil: 'poster i profilen',
  dagligt: 'dagliga poster', kv: 'inställningar', plan: 'rader i den gamla planen',
};

function reportText(r: MigrationReport): string {
  const parts = Object.entries(r.perCollection).map(([c, n]) => `${n} ${COLLECTION_TEXT[c] ?? c}`);
  return parts.join(', ');
}

/**
 * Web version with Firebase: before any data is loaded, the user creates or types the
 * password that the encryption key is made from. The password never leaves the browser.
 */
export function VaultScreen({ user, onOpen }: { user: CloudUser; onOpen: (vault: Vault) => void }) {
  const insets = useSafeAreaInsets();
  const docs = React.useMemo(() => cloudDocsFor(user.uid), [user.uid]);
  const [state, setState] = useState<VaultState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  useEffect(() => {
    readVaultState(docs).then(setState, (e: Error) => setLoadError(e.message || 'Firebase svarade inte.'));
  }, [docs]);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Fel lösenord. Försök igen.' : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run('Gör nyckeln av lösenordet…', async () => {
      const p = await prepareVault(docs, pw);
      if (p.trial && !p.trial.ok) throw new Error(p.trial.problem ?? 'Provkörningen misslyckades. Inget har ändrats.');
      if (!p.trial) {
        await commitVault(docs, p);
        onOpen(p.vault);
        return;
      }
      setPrepared(p);
    });

  const encryptReal = () =>
    run('Krypterar dina data i Firebase…', async () => {
      const r = await commitVault(docs, prepared!);
      if (r && !r.ok) throw new Error(r.problem ?? 'Krypteringen stoppades. De okrypterade posterna är orörda.');
      onOpen(prepared!.vault);
    });

  const unlock = () =>
    run('Låser upp…', async () => {
      const { vault, report } = await unlockVault(docs, state!.header!, pw);
      if (report && !report.ok) throw new Error(report.problem ?? 'Krypteringen stoppades.');
      onOpen(vault);
    });

  const page = (children: React.ReactNode) => (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: space.l }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ maxWidth: 460, width: '100%', alignSelf: 'center' }}>
        {children}
        {error ? <Card tone="red"><P>{error}</P></Card> : null}
        {busy ? <P muted style={{ textAlign: 'center' }}>{busy}</P> : null}
        <Button kind="ghost" title="Logga ut" onPress={() => void signOutUser()} disabled={!!busy} />
      </View>
    </ScrollView>
  );

  if (loadError) {
    return page(
      <>
        <Text style={[type.title, { marginBottom: space.s }]}>Firebase svarade inte</Text>
        <P muted>{loadError}</P>
      </>,
    );
  }
  if (!state) return page(<ActivityIndicator color={colors.accent} />);

  if (state.header) {
    return page(
      <>
        <Text style={[type.title, { marginBottom: space.s }]}>Lås upp dina data</Text>
        <P muted style={{ marginBottom: space.l }}>
          Dina data är krypterade. Skriv lösenordet du valde för krypteringen. Det är inte samma som inloggningen.
        </P>
        <Field
          label="LÖSENORD FÖR KRYPTERINGEN" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none"
          autoComplete="off" onSubmitEditing={() => pw && !busy && unlock()}
        />
        <Button big title="Lås upp" onPress={unlock} busy={!!busy} disabled={!pw || !!busy} />
        <P muted style={{ marginTop: space.l }}>
          Glömt lösenordet? Då går dina data inte att läsa, inte ens för dig. Det finns ingen återställning.
        </P>
      </>,
    );
  }

  if (prepared?.trial) {
    return page(
      <>
        <Text style={[type.title, { marginBottom: space.s }]}>Provkörningen gick bra</Text>
        <Card tone="green">
          <P>
            {`Appen krypterade en kopia av dina ${prepared.trial.found} poster här i webbläsaren, låste upp dem igen och jämförde med originalen. Alla stämde: ${reportText(prepared.trial)}.`}
          </P>
        </Card>
        <P style={{ marginBottom: space.l }}>
          Nu krypteras de riktiga posterna i Firebase. De krypterade kopiorna skrivs bredvid originalen och kontrolleras igen.
          Först när alla stämmer tas de okrypterade bort.
        </P>
        <Button big title={`Kryptera mina ${prepared.trial.found} poster`} onPress={encryptReal} busy={!!busy} disabled={!!busy} />
      </>,
    );
  }

  const tooShort = pw.length > 0 && pw.length < MIN_PASSWORD_LENGTH;
  const mismatch = pw2.length > 0 && pw !== pw2;
  return page(
    <>
      <Text style={[type.title, { marginBottom: space.s }]}>Välj ett lösenord för krypteringen</Text>
      <P muted style={{ marginBottom: space.m }}>
        Allt du sparar krypteras här i webbläsaren innan det skickas till Firebase. Nyckeln görs av ett lösenord som bara
        du känner till. Lösenordet lämnar aldrig webbläsaren och sparas ingenstans. Välj ett annat än det du loggar in med.
      </P>
      <Card tone="red">
        <Text style={[type.body, { fontWeight: '700' }]}>Glömmer du lösenordet går dina data inte att läsa.</Text>
        <P style={{ marginTop: space.xs }}>
          Inte för dig, inte för Google och inte för någon annan. Det finns ingen återställning. Skriv ner lösenordet och
          förvara det säkert.
        </P>
      </Card>
      {state.plain > 0 ? (
        <P style={{ marginBottom: space.m }}>
          {`Du har ${state.plain} poster sparade okrypterat i Firebase. De krypteras när du valt lösenord. Appen provkör först på en kopia i webbläsaren och visar resultatet innan något ändras i Firebase.`}
        </P>
      ) : null}
      <Field
        label="LÖSENORD" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password"
        hint={tooShort ? `Minst ${MIN_PASSWORD_LENGTH} tecken.` : `Minst ${MIN_PASSWORD_LENGTH} tecken. En mening går bra.`}
      />
      <Field
        label="SAMMA LÖSENORD IGEN" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" autoComplete="new-password"
        hint={mismatch ? 'Lösenorden är inte lika.' : undefined}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: understood }}
        onPress={() => setUnderstood(!understood)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s, minHeight: 44, paddingVertical: space.s, marginBottom: space.m }}
      >
        <View
          style={{
            width: 24, height: 24, borderRadius: 6, borderWidth: 2, marginTop: 1,
            borderColor: understood ? colors.accent : colors.border, backgroundColor: understood ? colors.accent : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {understood ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
        </View>
        <Text style={[type.body, { flex: 1 }]}>Jag förstår att glömt lösenord betyder att mina data inte går att läsa</Text>
      </Pressable>
      <Button
        big
        title={state.plain > 0 ? 'Välj lösenord och provkör' : 'Välj lösenord'}
        onPress={create}
        busy={!!busy}
        disabled={!!busy || pw.length < MIN_PASSWORD_LENGTH || pw !== pw2 || !understood}
      />
    </>,
  );
}
