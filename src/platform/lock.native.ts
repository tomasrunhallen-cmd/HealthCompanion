// App lock with Face ID, fingerprint or the phone's code.
import * as LocalAuthentication from 'expo-local-authentication';

export interface LockSupport {
  available: boolean;
  reason: string | null;
}

export async function lockSupport(): Promise<LockSupport> {
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      return { available: false, reason: 'Telefonen har ingen kod, Face ID eller fingeravtryck inställt.' };
    }
    return { available: true, reason: hw ? null : 'Låses med telefonens kod.' };
  } catch {
    return { available: false, reason: 'Applåset kunde inte startas på den här telefonen.' };
  }
}

export async function unlock(): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Lås upp Dagsljus',
    cancelLabel: 'Avbryt',
    disableDeviceFallback: false,
  });
  return res.success;
}
