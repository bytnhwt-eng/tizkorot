package com.tizkorot.app;

import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.telephony.TelephonyManager;

public class CtxReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        try {
            if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                String addr = null;
                try { addr = d != null ? d.getAddress() : null; } catch (SecurityException ignored) {}
                Ctx.fire(c, "car", addr, null);
            } else if (TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(action)) {
                String st = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
                String prev = Alarms.prefs(c).getString("callState", TelephonyManager.EXTRA_STATE_IDLE);
                Alarms.prefs(c).edit().putString("callState", st == null ? prev : st).apply();
                if (TelephonyManager.EXTRA_STATE_IDLE.equals(st) && TelephonyManager.EXTRA_STATE_OFFHOOK.equals(prev)) {
                    Ctx.fire(c, "call", null, null);
                }
            } else if (action.startsWith("com.tizkorot.PROX.")) {
                boolean entering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false);
                if (entering) Ctx.fire(c, "place", null, intent.getStringExtra("id"));
            }
        } catch (Exception ignored) {}
    }
}
