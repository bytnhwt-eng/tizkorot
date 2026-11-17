package com.tizkorot.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;

import org.json.JSONArray;
import org.json.JSONObject;

/** Context-triggered reminders: {id, title, type: "car"|"call"|"place", device, lat, lng, radius, nag, buddy}. */
public final class Ctx {
    static final String K_CTX = "ctx";

    private Ctx() {}

    static synchronized JSONArray all(Context c) {
        try { return new JSONArray(Alarms.prefs(c).getString(K_CTX, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static synchronized void saveAll(Context c, JSONArray a) {
        Alarms.prefs(c).edit().putString(K_CTX, a.toString()).apply();
    }

    static PendingIntent proxPi(Context c, String id) {
        Intent i = new Intent(c, CtxReceiver.class);
        i.setAction("com.tizkorot.PROX." + id);
        i.putExtra("id", id);
        return PendingIntent.getBroadcast(c, ("prox" + id).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    /** Replace the whole set; (re)register proximity alerts for places. */
    static synchronized void setAll(Context c, JSONArray list) {
        JSONArray old = all(c);
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null && "place".equals(o.optString("type"))) removeProx(c, o.optString("id"));
        }
        saveAll(c, list);
        registerPlaces(c);
    }

    static void registerPlaces(Context c) {
        JSONArray a = all(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !"place".equals(o.optString("type"))) continue;
            try {
                LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
                float r = (float) o.optDouble("radius", 150);
                lm.addProximityAlert(o.getDouble("lat"), o.getDouble("lng"), r, -1, proxPi(c, o.getString("id")));
            } catch (SecurityException | org.json.JSONException ignored) {}
        }
    }

    static void removeProx(Context c, String id) {
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            lm.removeProximityAlert(proxPi(c, id));
        } catch (Exception ignored) {}
    }

    /** Fire every reminder matching the predicate, remove them (one-shot) and notify the page. */
    static synchronized void fire(Context c, String type, String device, String onlyId) {
        JSONArray a = all(c);
        JSONArray keep = new JSONArray();
        boolean any = false;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            boolean match = type.equals(o.optString("type"));
            if (match && onlyId != null) match = onlyId.equals(o.optString("id"));
            if (match && "car".equals(type)) {
                String want = o.optString("device", "");
                match = want.isEmpty() || want.equalsIgnoreCase(device == null ? "" : device);
            }
            if (!match) { keep.put(o); continue; }
            any = true;
            try {
                JSONObject rec = new JSONObject();
                String id = o.getString("id");
                rec.put("key", id); rec.put("id", id); rec.put("kind", "main"); rec.put("repeat", "none");
                rec.put("title", o.optString("title"));
                rec.put("body", o.optString("body", "תזכורת לפי מצב"));
                rec.put("nag", o.optBoolean("nag"));
                rec.put("buddy", o.optString("buddy", ""));
                rec.put("at", System.currentTimeMillis());
                AlarmReceiver.show(c, rec);
                if (o.optBoolean("nag")) AlarmReceiver.startNag(c, rec);
                if ("place".equals(type)) removeProx(c, id);
                JSONObject ev = new JSONObject();
                ev.put("type", "ctxFired"); ev.put("id", id); ev.put("at", System.currentTimeMillis());
                Alarms.addEvent(c, ev);
            } catch (Exception ignored) {}
        }
        if (any) {
            saveAll(c, keep);
            MainActivity.notifyWeb();
        }
    }
}
