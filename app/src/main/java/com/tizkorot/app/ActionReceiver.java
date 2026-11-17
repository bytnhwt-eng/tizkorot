package com.tizkorot.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String id = intent.getStringExtra("id");
        String act = intent.getStringExtra("act");
        if (id == null || act == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(Alarms.code(id));
        try {
            JSONObject ev = new JSONObject();
            ev.put("id", id);
            if ("done".equals(act)) {
                ev.put("type", "done");
            } else {
                long min = "snooze60".equals(act) ? 60 : 10;
                long at = System.currentTimeMillis() + min * 60000L;
                ev.put("type", "snooze");
                ev.put("at", at);
                // schedule the snooze natively right away, so it rings even if the app stays closed
                JSONObject all = Alarms.all(c);
                JSONObject rec = all.optJSONObject(id);
                if (rec == null) {
                    rec = new JSONObject();
                    rec.put("key", id); rec.put("id", id); rec.put("kind", "main"); rec.put("repeat", "none");
                    rec.put("title", lastTitle(c, id));
                }
                // a repeating alarm already moved to its next time: snooze as a one-off copy
                String key = "none".equals(rec.optString("repeat", "none")) ? id : id + "_s";
                JSONObject s = new JSONObject(rec.toString());
                s.put("key", key); s.put("at", at); s.put("repeat", "none"); s.put("body", "נדחה ב-" + min + " דק׳");
                if (rec.optString("title").isEmpty()) s.put("title", lastTitle(c, id));
                all.put(key, s);
                Alarms.saveAll(c, all);
                Alarms.schedule(c, s);
            }
            Alarms.addEvent(c, ev);
            MainActivity.notifyWeb();
        } catch (Exception ignored) {}
    }

    static String lastTitle(Context c, String id) {
        return Alarms.prefs(c).getString("title_" + id, "תזכורת");
    }
}
