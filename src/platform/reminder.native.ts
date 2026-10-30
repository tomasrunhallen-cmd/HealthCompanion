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
