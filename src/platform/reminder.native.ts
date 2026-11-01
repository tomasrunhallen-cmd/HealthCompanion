// A local reminder on the user's own phone. Nothing is ever sent to anyone else.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ID = 'dagsljus-evening';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const reminderSupported = true;

export async function scheduleReminder(hour: number, minute: number): Promise<{ ok: boolean; message: string }> {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return { ok: false, message: 'Påminnelser är avstängda för Dagsljus i telefonens inställningar.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminder', {
      name: 'Kvällspåminnelse',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: { title: 'Dagsljus', body: 'Dags för kvällens avstämning. Det tar under två minuter.' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? 'reminder' : undefined,
    },
  });
  return { ok: true, message: 'Påminnelsen är inställd.' };
}

export async function cancelReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
}

export const reminderViaCalendar = false;

export const cancelHint: string | null = null;

const routineId = (id: string) => `dagsljus-routine-${id}`;

/** A daily reminder for one routine from the plan. The routine's own words are the notification text. */
export async function scheduleRoutineReminder(id: string, text: string, hour: number, minute: number): Promise<{ ok: boolean; message: string }> {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return { ok: false, message: 'Påminnelser är avstängda för Dagsljus i telefonens inställningar.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('routines', {
      name: 'Rutiner',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelScheduledNotificationAsync(routineId(id)).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: routineId(id),
    content: { title: 'Din rutin', body: text },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? 'routines' : undefined,
    },
  });
  return { ok: true, message: 'Påminnelsen är inställd.' };
}

export async function cancelRoutineReminder(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(routineId(id)).catch(() => undefined);
}

/** Cancels routine reminders whose routine no longer exists (removed elsewhere in the app). */
export async function cancelOrphanRoutineReminders(keep: string[]): Promise<void> {
  const keepIds = new Set(keep.map(routineId));
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of all) {
    if (n.identifier.startsWith('dagsljus-routine-') && !keepIds.has(n.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
    }
  }
}

/** A notice shown at once, e.g. the sleep notice. Only if the person allows notifications. */
export async function notifyNow(id: string, title: string, body: string): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return false;
  await Notifications.scheduleNotificationAsync({ identifier: id, content: { title, body }, trigger: null });
  return true;
}
