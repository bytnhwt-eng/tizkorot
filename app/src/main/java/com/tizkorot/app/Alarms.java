package com.tizkorot.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Iterator;

/** Alarm storage + scheduling. Every alarm record: {key, id, title, body, at, repeat, kind("main"|"early"), early}. */
public final class Alarms {
    static final String PREFS = "tizkorot";
    static final String K_ALARMS = "alarms";
    static final String K_EVENTS = "events";
    static final String CH_MAIN = "reminders_main";
    static final String CH_EARLY = "reminders_early";

    private Alarms() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static synchronized JSONObject all(Context c) {
        try { return new JSONObject(prefs(c).getString(K_ALARMS, "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    static synchronized void saveAll(Context c, JSONObject o) { prefs(c).edit().putString(K_ALARMS, o.toString()).apply(); }

    static synchronized void addEvent(Context c, JSONObject ev) {
        try {
            JSONArray a = new JSONArray(prefs(c).getString(K_EVENTS, "[]"));
            a.put(ev);
            prefs(c).edit().putString(K_EVENTS, a.toString()).apply();
        } catch (Exception ignored) {}
    }

    static synchronized String takeEvents(Context c) {
        String s = prefs(c).getString(K_EVENTS, "[]");
        prefs(c).edit().putString(K_EVENTS, "[]").apply();
        return s;
    }

    static int code(String key) { return key.hashCode(); }

    static PendingIntent alarmPi(Context c, String key) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction("com.tizkorot.ALARM");
        i.putExtra("key", key);
        return PendingIntent.getBroadcast(c, code(key), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openAppPi(Context c, String key) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("alarmKey", key);
        return PendingIntent.getActivity(c, code(key) + 7, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) return am.canScheduleExactAlarms();
        return true;
    }

    static void schedule(Context c, JSONObject rec) {
        try {
            long at = rec.getLong("at");
            if (at <= System.currentTimeMillis() - 1000) return;
            String key = rec.getString("key");
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi = alarmPi(c, key);
            if (canExact(c)) {
                // setAlarmClock is the most reliable: survives Doze and shows the alarm icon.
                if ("main".equals(rec.optString("kind"))) {
                    am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openAppPi(c, key)), pi);
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception ignored) {}
    }

    static void cancel(Context c, String key) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmPi(c, key));
    }

    /** Replace the whole set with what the app sends. */
    static synchronized void setAll(Context c, JSONArray list) {
        JSONObject old = all(c);
        JSONObject now = new JSONObject();
        try {
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.getJSONObject(i);
                now.put(r.getString("key"), r);
            }
            Iterator<String> it = old.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (now.has(k)) continue;
                // keep test alarms and notification snoozes of repeating reminders until they ring
                if (("test".equals(k) || k.endsWith("_s")) && old.getJSONObject(k).optLong("at") > System.currentTimeMillis()) {
                    now.put(k, old.getJSONObject(k));
                    continue;
                }
                cancel(c, k);
            }
            Iterator<String> it2 = now.keys();
            while (it2.hasNext()) {
                String k = it2.next();
                JSONObject r = now.getJSONObject(k);
                JSONObject o = old.optJSONObject(k);
                if (o == null || o.optLong("at") != r.optLong("at") || !o.optString("title").equals(r.optString("title"))) {
                    schedule(c, r);
                }
            }
        } catch (Exception ignored) {}
        saveAll(c, now);
    }

    static synchronized void rescheduleAll(Context c) {
        JSONObject o = all(c);
        Iterator<String> it = o.keys();
        while (it.hasNext()) {
            JSONObject r = o.optJSONObject(it.next());
            if (r != null) schedule(c, r);
        }
    }

    static long nextRepeat(long at, String rep) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(at);
        long now = System.currentTimeMillis();
        int guard = 0;
        do {
            switch (rep) {
                case "daily": cal.add(Calendar.DAY_OF_MONTH, 1); break;
                case "weekly": cal.add(Calendar.DAY_OF_MONTH, 7); break;
                case "monthly": cal.add(Calendar.MONTH, 1); break;
                case "weekdays":
                    do { cal.add(Calendar.DAY_OF_MONTH, 1); }
                    while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY);
                    break;
                default: return -1;
            }
        } while (cal.getTimeInMillis() <= now && ++guard < 2000);
        return cal.getTimeInMillis();
    }

    static void ensureChannels(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH_MAIN) == null) {
            NotificationChannel ch = new NotificationChannel(CH_MAIN, "תזכורות", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("התראה בזמן התזכורת");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 800});
            Uri snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (snd == null) snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            ch.setSound(snd, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_EARLY) == null) {
            NotificationChannel ch = new NotificationChannel(CH_EARLY, "התראות מוקדמות", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("תזכורת מוקדמת לפני הזמן");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
    }
}
