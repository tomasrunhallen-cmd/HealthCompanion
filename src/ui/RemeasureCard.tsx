// "Nya värden från klockan": a day saved while the watch had not synced, shown with the values
// it has now and what the level becomes with them. The person chooses; nothing changes before.

import React, { useState } from 'react';
import { Text } from 'react-native';
import { formatDateSv } from '../core/analysis/dates';
import type { Remeasured } from '../core/analysis/remeasure';
import { applyRemeasure, keepAsItWas } from '../services/remeasure';
import { Button, Card, Dot, P, Row } from './components';
import { useRepo } from './state';
import { LEVEL_TEXT, space, type } from './theme';

export function RemeasureCard({ r, onDone }: { r: Remeasured; onDone?: (updated: boolean) => void }) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  const levelChanges = r.after.level !== r.before.level;
  return (
    <Card tone="accent">
      <Text style={type.h2} accessibilityRole="header">Nya värden från klockan för {formatDateSv(r.entry.date)}</Text>
      <P muted style={{ marginTop: space.xs }}>Klockan har synkat efter avstämningen:</P>
      {r.changes.map((c) => <P key={c} style={{ marginTop: space.xs }}>{`• ${c}`}</P>)}
      <Row style={{ marginTop: space.s }}>
        <Dot level={r.after.level} size={18} />
        <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }]}>
          {levelChanges
            ? `Med dem blir dagen ${LEVEL_TEXT[r.after.level].toLowerCase()}, inte ${LEVEL_TEXT[r.before.level].toLowerCase()}.`
            : `Dagen är fortfarande ${LEVEL_TEXT[r.after.level].toLowerCase()}.`}
        </Text>
      </Row>
      <Button
        title="Uppdatera dagen"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await applyRemeasure(repo, r);
            onDone?.(true);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button kind="ghost" title="Behåll som det var" onPress={async () => { await keepAsItWas(repo, r); onDone?.(false); }} />
    </Card>
  );
}
