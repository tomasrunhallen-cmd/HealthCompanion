// Läget i dag on Hem: two or three sentences on how things are going, with what they rest on one
// tap away. See services/status.ts and core/plan/status.ts.

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { statusFacts } from '../core/plan/status';
import { makeStatus, statusInput, statusToday, type StatusToday as Status } from '../services/status';
import { Button, Card, P, Tag } from './components';
import { useNav } from './nav';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

export function StatusToday() {
  const repo = useRepo();
  const nav = useNav();
  const [status, setStatus] = useState<Status | null>(() => statusToday(repo));
  const [why, setWhy] = useState(false);
  // The facts as they are now; the text is made again when they change (at most twice a day).
  const facts = statusFacts(statusInput(repo));
  const key = JSON.stringify([facts.tone, facts.lines]);
  const hasData = facts.lines.length > 1 || !facts.lines[0]?.includes('inga avstämningar');
  // Like the day's routine suggestion: wait, at most 15 seconds, for the watch's sync when the app opens.
  const garmin = repo.garminStatus();
  const [atOpen] = useState(() => ({ syncAt: garmin.lastSyncAt, recent: !!garmin.lastSyncAt && Date.now() - new Date(garmin.lastSyncAt).getTime() < 30 * 60_000 }));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 15_000);
    return () => clearTimeout(t);
  }, []);
  const watchReady = !garmin.connected || atOpen.recent || garmin.lastSyncAt !== atOpen.syncAt || !!garmin.lastError || waited;
  const stale = !status || (status.key !== key && status.remakes < 2);
  useEffect(() => {
    if (!hasData || !watchReady || !stale) return;
    let live = true;
    makeStatus(repo, { browser: Platform.OS === 'web' }).then((s) => live && setStatus(s)).catch(() => undefined);
    return () => { live = false; };
  }, [repo, hasData, watchReady, stale, key]);
  const lines = useMemo(() => status?.facts ?? [], [status]);
  if (!hasData || !status) return null;

  return (
    <Card style={{ marginTop: space.m }}>
      <Text style={type.label} accessibilityRole="header">LÄGET I DAG</Text>
      <P style={{ marginTop: space.xs }}>{status.text}</P>
      {status.tone === 'plan' ? <Button kind="secondary" title="Hjälp nu" onPress={() => nav.push({ name: 'crisis' })} /> : null}
      {status.method === 'llm' ? <Tag label="Formulerat av AI" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: why }}
        onPress={() => setWhy((v) => !v)}
        style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
      >
        <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{why ? 'Dölj vad det bygger på' : 'Vad bygger det på?'}</Text>
      </Pressable>
      {why ? (
        <>
          {lines.map((l) => <P key={l} muted style={{ marginTop: space.xs }}>{`• ${l}`}</P>)}
          <P muted style={{ marginTop: space.s }}>
            Appen räknar fram det här själv. {status.method === 'llm' ? 'Språkmodellen formulerar bara meningarna, och de kontrolleras: inga siffror utöver dessa, inga diagnoser och ingen nivå.' : 'Ingen språkmodell användes.'} Tonen följer läget: uppmuntran bara en lugn vecka.
          </P>
        </>
      ) : null}
    </Card>
  );
}
