// App-wide access to the repository and a simple confirm dialog that also works on web.

import React, { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Repository } from '../storage/repository';
import { colors, radius, space, type } from './theme';
import { Button } from './components';

const RepoContext = createContext<Repository | null>(null);

export function RepoProvider(props: { repo: Repository; children: React.ReactNode }) {
  return <RepoContext.Provider value={props.repo}>{props.children}</RepoContext.Provider>;
}

/** Returns the repository and re-renders when data changes. */
export function useRepo(): Repository {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error('useRepo utanför RepoProvider');
  useSyncExternalStore(
    (cb) => repo.subscribe(cb),
    () => repo.revision,
  );
  return repo;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

interface DialogApi {
  confirm(o: ConfirmOptions): Promise<boolean>;
  info(title: string, message: string): Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void; infoOnly?: boolean }) | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  const info = useCallback(
    (title: string, message: string) =>
      new Promise<void>((resolve) => setState({ title, message, confirmLabel: 'OK', infoOnly: true, resolve: () => resolve() })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <DialogContext.Provider value={{ confirm, info }}>
      {props.children}
      <Modal transparent visible={!!state} animationType="fade" onRequestClose={() => close(false)}>
        <Pressable style={styles.backdrop} onPress={() => close(false)}>
          <Pressable style={styles.box} onPress={() => undefined}>
            <Text style={type.h2}>{state?.title}</Text>
            <Text style={[type.body, { marginTop: space.s, marginBottom: space.l }]}>{state?.message}</Text>
            <Button title={state?.confirmLabel ?? 'OK'} kind={state?.danger ? 'danger' : 'primary'} onPress={() => close(true)} />
            {!state?.infoOnly && <Button title="Avbryt" kind="ghost" onPress={() => close(false)} />}
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const d = useContext(DialogContext);
  if (!d) throw new Error('useDialog utanför DialogProvider');
  return d;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,28,25,0.45)', justifyContent: 'center', padding: space.l },
  box: { backgroundColor: colors.surface, borderRadius: radius.l, padding: space.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
});
