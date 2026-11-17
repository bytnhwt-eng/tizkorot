package com.tizkorot.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

import org.json.JSONObject;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String key = intent.getStringExtra("key");
        if (key == null) return;
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tizkorot:alarm");
        wl.acquire(10_000);
        try {
            JSONObject all = Alarms.all(c);
            JSONObject rec = all.optJSONObject(key);
            if (rec == null) return;
            show(c, rec);

            String kind = rec.optString("kind", "main");
            String repeat = rec.optString("repeat", "none");
            if ("main".equals(kind) && !"none".equals(repeat)) {
                long next = Alarms.nextRepeat(rec.getLong("at"), repeat);
                if (next > 0) {
                    rec.put("at", next);
                    all.put(key, rec);
                    // move early alert too
                    String ek = rec.optString("id") + "_e";
                    JSONObject er = all.optJSONObject(ek);
                    if (er != null) {
                        long early = rec.optLong("early", 0) * 60000L;
                        er.put("at", next - early);
                        all.put(ek, er);
                        Alarms.saveAll(c, all);
                        Alarms.schedule(c, er);
                    }
                    Alarms.saveAll(c, all);
                    Alarms.schedule(c, rec);
                    JSONObject ev = new JSONObject();
                    ev.put("type", "moved"); ev.put("id", rec.optString("id")); ev.put("at", next);
                    Alarms.addEvent(c, ev);
                }
            } else {
                all.remove(key);
                Alarms.saveAll(c, all);
                if ("main".equals(kind)) {
                    JSONObject ev = new JSONObject();
                    ev.put("type", "fired"); ev.put("id", rec.optString("id"));
                    Alarms.addEvent(c, ev);
                }
            }
            MainActivity.notifyWeb();
        } catch (Exception ignored) {
        } finally {
            if (wl.isHeld()) wl.release();
        }
    }

    static void show(Context c, JSONObject rec) {
        Alarms.ensureChannels(c);
        String id = rec.optString("id");
        String key = rec.optString("key");
        boolean main = "main".equals(rec.optString("kind", "main"));
        int nid = Alarms.code(id);
        Alarms.prefs(c).edit().putString("title_" + id, rec.optString("title")).apply();

        Notification.Builder b = new Notification.Builder(c, main ? Alarms.CH_MAIN : Alarms.CH_EARLY)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF7C6CFF)
                .setContentTitle((main ? "⏰ " : "🔔 ") + rec.optString("title"))
                .setContentText(rec.optString("body"))
                .setStyle(new Notification.BigTextStyle().bigText(rec.optString("title") + "\n" + rec.optString("body")))
                .setCategory(main ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setContentIntent(Alarms.openAppPi(c, key));

        if (main) {
            b.setFullScreenIntent(Alarms.openAppPi(c, key), true);
            b.addAction(new Notification.Action.Builder(null, "✓ בוצע", actionPi(c, id, "done")).build());
            b.addAction(new Notification.Action.Builder(null, "עוד 10 דק׳", actionPi(c, id, "snooze10")).build());
            b.addAction(new Notification.Action.Builder(null, "עוד שעה", actionPi(c, id, "snooze60")).build());
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(main ? nid : nid + 1, b.build()); } catch (SecurityException ignored) {}
    }

    static PendingIntent actionPi(Context c, String id, String act) {
        Intent i = new Intent(c, ActionReceiver.class);
        i.setAction("com.tizkorot.ACT." + act);
        i.putExtra("id", id);
        i.putExtra("act", act);
        return PendingIntent.getBroadcast(c, (id + act).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
