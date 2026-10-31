import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authErrorText } from '../../cloud/errors';
import { resetPassword, signIn, signUp } from '../../cloud/firebase';
import { Button, Card, Field, P } from '../components';
import { colors, space, type } from '../theme';

/** Web version with Firebase: sign in before any data is loaded. */
export function SignInScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | 'reset' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (kind: 'in' | 'up' | 'reset') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'in') await signIn(email, password);
      if (kind === 'up') await signUp(email, password);
      if (kind === 'reset') {
        await resetPassword(email);
        setMessage({ text: 'Ett mejl för att välja nytt lösenord är skickat, om kontot finns.', error: false });
      }
    } catch (e) {
      setMessage({ text: authErrorText(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const ready = /.+@.+\..+/.test(email.trim());
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: space.l }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ maxWidth: 420, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { marginBottom: space.s }]}>Dagsljus</Text>
        <P muted style={{ marginBottom: space.xl }}>
          Logga in med ditt konto i din egen Firebase. Där sparas din krisplan och dina anteckningar, så att de finns kvar
          även om webbläsaren rensas.
        </P>
        <Field label="E-POST" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
        <Field label="LÖSENORD" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" onSubmitEditing={() => ready && password && run('in')} />
        {message ? (
          <Card tone={message.error ? 'red' : 'green'}>
            <P>{message.text}</P>
          </Card>
        ) : null}
        <Button big title="Logga in" onPress={() => run('in')} busy={busy === 'in'} disabled={!ready || !password} />
        <Button kind="secondary" title="Skapa konto" onPress={() => run('up')} busy={busy === 'up'} disabled={!ready || password.length < 8} />
        <Button kind="ghost" title="Glömt lösenordet" onPress={() => run('reset')} busy={busy === 'reset'} disabled={!ready} />
        <P muted style={{ marginTop: space.l }}>
          Skapa kontot en gång. Stäng sedan av nya konton i Firebase, så att ingen annan kan registrera sig här.
        </P>
      </View>
    </ScrollView>
  );
}
