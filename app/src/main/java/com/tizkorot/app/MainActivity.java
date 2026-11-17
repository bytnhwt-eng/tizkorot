package com.tizkorot.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

public class MainActivity extends Activity {
    private WebView web;
    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private final Handler ui = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Alarms.ensureChannels(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0F1020);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith("file:")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent i) {
        if (i == null) return;
        String key = i.getStringExtra("alarmKey");
        if (key != null) {
            String id = key.endsWith("_e") || key.endsWith("_s") ? key.substring(0, key.length() - 2) : key;
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(Alarms.code(id));
            final String js = "window.onNativeOpen&&window.onNativeOpen(" + JSONObject.quote(id) + ")";
            ui.postDelayed(() -> { if (web != null) web.evaluateJavascript(js, null); }, 600);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        if (web != null) web.evaluateJavascript("window.onNativeEvents&&window.onNativeEvents()", null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        current = new WeakReference<>(null);
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript("window.onNativeBack?window.onNativeBack():false", v -> {
                if (!"true".equals(v)) moveTaskToBack(true);
            });
        } else super.onBackPressed();
    }

    /** Called from receivers: if the app is open, let the page pull events now. */
    static void notifyWeb() {
        MainActivity a = current.get();
        if (a == null) return;
        a.ui.post(() -> { if (a.web != null) a.web.evaluateJavascript("window.onNativeEvents&&window.onNativeEvents()", null); });
    }

    class Bridge {
        @JavascriptInterface
        public void setAlarms(String json) {
            try { Alarms.setAll(MainActivity.this, new JSONArray(json)); } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String takeEvents() { return Alarms.takeEvents(MainActivity.this); }

        @JavascriptInterface
        public String status() {
            JSONObject o = new JSONObject();
            try {
                boolean notif = ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled();
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                o.put("notifications", notif);
                o.put("exact", Alarms.canExact(MainActivity.this));
                o.put("battery", pm.isIgnoringBatteryOptimizations(getPackageName()));
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    startActivity(i);
                } catch (Exception e) { openAppSettings(); }
            });
        }

        @JavascriptInterface
        public void openBatterySettings() {
            ui.post(() -> {
                try {
                    @SuppressLint("BatteryLife")
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception e) { openAppSettings(); }
            });
        }

        @JavascriptInterface
        public void openExactSettings() {
            ui.post(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= 31) {
                        startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
                    }
                } catch (Exception e) { openAppSettings(); }
            });
        }

        @JavascriptInterface
        public void testAlarm(String title) {
            try {
                JSONObject r = new JSONObject();
                r.put("key", "test"); r.put("id", "test"); r.put("kind", "main"); r.put("repeat", "none");
                r.put("title", title); r.put("body", "ככה תיראה תזכורת 👍");
                r.put("at", System.currentTimeMillis() + 5000);
                JSONObject all = Alarms.all(MainActivity.this);
                all.put("test", r);
                Alarms.saveAll(MainActivity.this, all);
                Alarms.schedule(MainActivity.this, r);
            } catch (Exception ignored) {}
        }

        private void openAppSettings() {
            try {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception ignored) {}
        }
    }
}
