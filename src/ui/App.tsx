import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { lockSupport, unlock } from '../platform/lock';
import { openBackend } from '../storage/openBackend';
import { Repository } from '../storage/repository';
import { Button } from './components';
import { NavProvider, type Route } from './nav';
import { CheckinScreen } from './screens/CheckinScreen';
import { HistoryScreen } from './screens/HistoryScreen';
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
    case 'privacy': return <PrivacyScreen />;
    case 'history': return <HistoryScreen />;
  }
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
  const appState = useRef(AppState.currentState);

  const tryUnlock = useCallback(async () => {
    setChecking(true);
    try {
      const support = await lockSupport();
      if (!props.repo.settings().appLockEnabled || !support.available) {
        setLocked(false);
        return;
      }
      setLocked(!(await unlock()));
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

  if (!locked) return <>{props.children}</>;
  return (
    <Centered>
      <Text style={[type.title, { marginBottom: space.m }]}>Dagsljus</Text>
      {checking ? <ActivityIndicator color={colors.accent} /> : <Button title="Lås upp" onPress={tryUnlock} />}
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
