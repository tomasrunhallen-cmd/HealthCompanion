import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { lockSupport, unlock, usesPin } from '../platform/lock';
import { syncOnOpen } from '../services/garmin';
import { openBackend } from '../storage/openBackend';
import { Repository } from '../storage/repository';
import { Button, Field } from './components';
import { NavProvider, type Route } from './nav';
import { CheckinScreen } from './screens/CheckinScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { GarminScreen } from './screens/GarminScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LlmSettingsScreen } from './screens/LlmSettingsScreen';
import { PlanImportScreen } from './screens/PlanImportScreen';
import { PlanScreen } from './screens/PlanScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DialogProvider, RepoProvider } from './state';
import { colors, space, type } from './theme';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home': return <HomeScreen />;
    case 'checkin': return <CheckinScreen />;
    case 'result': return <ResultScreen entryId={route.entryId} />;
    case 'plan': return <PlanScreen />;
    case 'planImport': return <PlanImportScreen />;
    case 'settings': return <SettingsScreen />;
    case 'llm': return <LlmSettingsScreen />;
    case 'garmin': return <GarminScreen />;
    case 'privacy': return <PrivacyScreen />;
    case 'history': return <HistoryScreen />;
  }
}

/** Fetches missing Garmin days when the unlocked app opens or comes back to the front. */
function GarminAutoSync(props: { repo: Repository }) {
  useEffect(() => {
    syncOnOpen(props.repo);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncOnOpen(props.repo);
    });
    return () => sub.remove();
  }, [props.repo]);
  return null;
}

function Centered(props: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
      {props.children}
    </View>
  );
}

/** Locks the app on start and whenever it returns from the background. */
function LockGate(props: { repo: Repository; children: React.ReactNode }) {
  const [locked, setLocked] = useState(true);
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  const tryUnlock = useCallback(async (typed?: string) => {
    setChecking(true);
    try {
      const support = await lockSupport();
      if (!props.repo.settings().appLockEnabled || !support.available) {
        setLocked(false);
        return;
      }
      // On the web the lock is a PIN typed below; wait for it.
      if (usesPin && typed == null) {
        setLocked(true);
        return;
      }
      const ok = await unlock(typed);
      setLocked(!ok);
      setPin('');
      setPinError(usesPin && !ok ? 'Fel kod. Försök igen.' : null);
    } finally {
      setChecking(false);
    }
  }, [props.repo]);

  useEffect(() => {
    tryUnlock();
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current === 'background' && next === 'active') {
        setLocked(true);
        tryUnlock();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [tryUnlock]);

  if (!locked) return <><GarminAutoSync repo={props.repo} />{props.children}</>;
  return (
    <Centered>
      <Text style={[type.title, { marginBottom: space.m }]}>Dagsljus</Text>
      {usesPin && !checking ? (
        <View style={{ width: '100%', maxWidth: 320 }}>
          <Field
            label="DIN KOD"
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 8))}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={() => tryUnlock(pin)}
            hint={pinError ?? undefined}
          />
          <Button title="Lås upp" onPress={() => tryUnlock(pin)} disabled={pin.length < 4} />
        </View>
      ) : checking ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Button title="Lås upp" onPress={() => tryUnlock()} />
      )}
    </Centered>
  );
}

export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openBackend()
      .then(Repository.create)
      .then(setRepo)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {error ? (
        <Centered>
          <Text style={type.h2}>Databasen kunde inte öppnas</Text>
          <Text style={[type.small, { marginTop: space.s }]}>{error}</Text>
        </Centered>
      ) : !repo ? (
        <Centered><ActivityIndicator color={colors.accent} /></Centered>
      ) : (
        <RepoProvider repo={repo}>
          <DialogProvider>
            <LockGate repo={repo}>
              <NavProvider>{renderRoute}</NavProvider>
            </LockGate>
          </DialogProvider>
        </RepoProvider>
      )}
    </SafeAreaProvider>
  );
}
