// "Hjälp nu" where the app's own tabs are not there yet: the lock screen, signing in, opening
// the encrypted data, loading, and when something failed. Only the crisis numbers: the plan is
// locked away until the app is open. Needs nothing from the database.

import React, { Component, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CrisisCard } from './CrisisCard';
import { Button } from './components';
import { colors, MIN_TOUCH, space, type } from './theme';

/** A "Hjälp nu" button in the top corner that opens the crisis numbers. */
export function EmergencyHelp() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hjälp nu"
        accessibilityHint="Visar krisnumren"
        onPress={() => setOpen(true)}
        style={{ position: 'absolute', top: insets.top + space.s, right: space.l, minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', zIndex: 10 }}
      >
        <Text style={[type.body, { color: colors.red, fontWeight: '700' }]}>Hjälp nu</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.l, paddingTop: space.xl }}>
          <CrisisCard plan={[]} sheet numbersOnly />
          <Button kind="secondary" title="Stäng" onPress={() => setOpen(false)} />
        </ScrollView>
      </Modal>
    </>
  );
}

/** Something failed while drawing the app: say so, and keep the crisis numbers on screen. */
export class HelpOnError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.l, paddingTop: space.xxl }}>
        <View style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Text style={[type.h2, { marginBottom: space.m }]} accessibilityRole="header">Något gick fel i appen</Text>
          <CrisisCard plan={[]} sheet numbersOnly />
        </View>
      </ScrollView>
    );
  }
}
