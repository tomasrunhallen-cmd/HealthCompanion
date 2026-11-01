// "Stämmer" / "Stämmer inte" after an assessment, with an optional line of text.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { correctionFor, saveCorrection } from '../services/corrections';
import type { Assessment } from '../core/domain/types';
import { Button, Card, Chip, Field, P, Row } from './components';
import { useNav } from './nav';
import { useDialog, useRepo } from './state';
import { space, type } from './theme';

export function CorrectionBox({ assessment }: { assessment: Assessment }) {
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
  const saved = correctionFor(repo, assessment.id);
  const signs = assessment.signals.filter((s) => s.planItemId);
  const [editing, setEditing] = useState(saved.length === 0);
  const [verdict, setVerdict] = useState<'agree' | 'disagree' | null>(null);
  const [chosen, setChosen] = useState<string[]>(signs.map((s) => s.planItemId!));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!editing && saved.length) {
    const v = saved[0].correction?.verdict === 'agree' ? 'stämde' : 'inte stämde';
    const about = saved.map((c) => signs.find((s) => s.planItemId === c.correction?.planItemId)?.label).filter(Boolean);
    return (
      <Card>
        <P>
          Du sa att bedömningen {v}{about.length ? `, om ${about.map((a) => `”${a}”`).join(', ')}` : ''}.
          {saved[0].text ? ` ”${saved[0].text}”` : ''}
        </P>
        <Button kind="ghost" title="Ändra" onPress={() => setEditing(true)} />
      </Card>
    );
  }

  const save = async () => {
    if (!verdict) return;
    setBusy(true);
    try {
      const fresh = await saveCorrection(repo, assessment, { verdict, planItemIds: chosen, text });
      setEditing(false);
      if (fresh.length) {
        const go = await dialog.confirm({
          title: 'Ett förslag väntar',
          message: fresh[0].reason,
          confirmLabel: 'Visa förslaget',
        });
        if (go) {
          // HIG: one sheet at a time. Close this one before the proposals open.
          nav.close();
          nav.push({ name: 'suggestions' });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={type.h2}>Stämmer bedömningen?</Text>
      <Row style={{ marginTop: space.s }}>
        <Chip label="Stämmer" selected={verdict === 'agree'} onPress={() => setVerdict('agree')} />
        <Chip label="Stämmer inte" selected={verdict === 'disagree'} onPress={() => setVerdict('disagree')} />
      </Row>
      {verdict && signs.length ? (
        <View style={{ marginTop: space.m }}>
          <Text style={type.label}>{verdict === 'agree' ? 'VILKA TECKEN STÄMDE?' : 'VILKA TECKEN STÄMDE INTE?'}</Text>
          <Row style={{ marginTop: space.xs, gap: 6 }}>
            {signs.map((s) => (
              <Chip
                key={s.planItemId}
                label={s.label}
                selected={chosen.includes(s.planItemId!)}
                onPress={() => setChosen((c) => (c.includes(s.planItemId!) ? c.filter((x) => x !== s.planItemId) : [...c, s.planItemId!]))}
              />
            ))}
          </Row>
        </View>
      ) : null}
      {verdict ? (
        <View style={{ marginTop: space.m }}>
          <Field label="VILL DU LÄGGA TILL NÅGOT? (VALFRITT)" value={text} onChangeText={setText} placeholder="Till exempel: jag var bara trött efter resan" />
          <Button title="Spara" onPress={save} busy={busy} />
          <P muted>Rättelsen sparas i det appen vet om dig. Den ändrar inte dagens nivå, men modellen får se den nästa gång.</P>
        </View>
      ) : null}
    </Card>
  );
}
