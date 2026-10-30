// API keys in iOS Keychain / Android Keystore. THIS_DEVICE_ONLY: never in a backup.

import * as SecureStore from 'expo-secure-store';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secretsPersist = true;

export async function getSecret(name: string): Promise<string | null> {
  return SecureStore.getItemAsync(name, OPTS);
}

export async function setSecret(name: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(name, value, OPTS);
}

export async function deleteSecret(name: string): Promise<void> {
  await SecureStore.deleteItemAsync(name, OPTS);
}
