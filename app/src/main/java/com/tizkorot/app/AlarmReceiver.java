package com.tizkorot.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.telephony.SmsManager;

import org.json.JSONObject;

public class AlarmReceiver extends BroadcastReceiver {
    static final long NAG_EVERY = 2 * 60_000L;
    static final int NAG_SMS_AFTER = 3;
    static final int NAG_MAX = 20;

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
            String kind = rec.optString("kind", "main");

            if ("nag".equals(kind)) {
                handleNag(c, all, key, rec);
                MainActivity.notifyWeb();
                return;
            }

            show(c, rec);

            String repeat = rec.optString("repeat", "none");
            if ("main".equals(kind) && !"none".equals(repeat)) {
                long next = Alarms.nextRepeat(rec.getLong("at"), repeat);
                if (next > 0) {
                    rec.put("at", next);
                    all.put(key, rec);
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
            } else if ("main".equals(kind)) {
                JSONObject ev = new JSONObject();
                ev.put("type", "fired"); ev.put("id", rec.optString("id"));
                Alarms.addEvent(c, ev);
                if (!rec.optBoolean("nag")) {
                    all.remove(key);
                    Alarms.saveAll(c, all);
                }
            } else {
                all.remove(key);
                Alarms.saveAll(c, all);
            }
            if ("main".equals(kind) && rec.optBoolean("nag")) startNag(c, rec);
            MainActivity.notifyWeb();
        } catch (Exception ignored) {
        } finally {
            if (wl.isHeld()) wl.release();
        }
    }

    /** Begin "don't let me escape" mode: ring again every 2 minutes until marked done. */
    static void startNag(Context c, JSONObject rec) {
        try {
            String id = rec.optString("id");
            JSONObject n = new JSONObject();
            n.put("key", id + "_n"); n.put("id", id); n.put("kind", "nag"); n.put("repeat", "none");
            n.put("title", rec.optString("title"));
            n.put("buddy", rec.optString("buddy", ""));
            n.put("count", 0);
            n.put("at", System.currentTimeMillis() + NAG_EVERY);
            JSONObject all = Alarms.all(c);
            all.put(id + "_n", n);
            Alarms.saveAll(c, all);
            Alarms.schedule(c, n);
        } catch (Exception ignored) {}
    }

    static void handleNag(Context c, JSONObject all, String key, JSONObject n) throws Exception {
        int count = n.optInt("count", 0) + 1;
        n.put("count", count);
        JSONObject shown = new JSONObject(n.toString());
        shown.put("kind", "main");
        shown.put("key", n.optString("id"));
        shown.put("body", "עדיין לא סימנת שביצעת (" + count + ")");
        shown.put("nag", true);
        show(c, shown);

        String buddy = n.optString("buddy", "").trim();
        if (count == NAG_SMS_AFTER && !buddy.isEmpty() && !n.optBoolean("smsSent")) {
            sendSms(c, buddy, "⏰ תזכורת שעדיין לא בוצעה: " + n.optString("title") + "\n(נשלח אוטומטית מאפליקציית התזכורות)");
            n.put("smsSent", true);
            JSONObject ev = new JSONObject();
            ev.put("type", "smsSent"); ev.put("id", n.optString("id"));
            Alarms.addEvent(c, ev);
        }
        if (count < NAG_MAX) {
            n.put("at", System.currentTimeMillis() + NAG_EVERY);
            all.put(key, n);
            Alarms.saveAll(c, all);
            Alarms.schedule(c, n);
        } else {
            all.remove(key);
            Alarms.saveAll(c, all);
        }
    }

    static void sendSms(Context c, String phone, String text) {
        try {
            if (c.checkSelfPermission(android.Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return;
            SmsManager sm = c.getSystemService(SmsManager.class);
            if (sm == null) sm = SmsManager.getDefault();
            sm.sendMultipartTextMessage(phone, null, sm.divideMessage(text), null, null);
        } catch (Exception ignored) {}
    }

    static void show(Context c, JSONObject rec) {
        Alarms.ensureChannels(c);
        String id = rec.optString("id");
        String key = rec.optString("key");
        boolean main = "main".equals(rec.optString("kind", "main"));
        boolean nag = rec.optBoolean("nag");
        int nid = Alarms.code(id);
        Alarms.prefs(c).edit().putString("title_" + id, rec.optString("title")).apply();

        Notification.Builder b = new Notification.Builder(c, main ? Alarms.CH_MAIN : Alarms.CH_EARLY)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(nag ? 0xFFFF5D6C : 0xFF7C6CFF)
                .setContentTitle((nag ? "🔥 " : main ? "⏰ " : "🔔 ") + rec.optString("title"))
                .setContentText(rec.optString("body"))
                .setStyle(new Notification.BigTextStyle().bigText(rec.optString("title") + "\n" + rec.optString("body")))
                .setCategory(main ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(!nag)
                .setOngoing(nag)
                .setShowWhen(true)
                .setContentIntent(Alarms.openAppPi(c, key));

        if (main) {
            b.setFullScreenIntent(Alarms.openAppPi(c, key), true);
            b.addAction(new Notification.Action.Builder(null, "✓ בוצע", actionPi(c, id, "done")).build());
            if (!nag) {
                b.addAction(new Notification.Action.Builder(null, "עוד 10 דק׳", actionPi(c, id, "snooze10")).build());
                b.addAction(new Notification.Action.Builder(null, "עוד שעה", actionPi(c, id, "snooze60")).build());
            }
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
