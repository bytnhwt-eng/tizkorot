package com.tizkorot.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
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
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_PERMS = 11;
    private static final int REQ_VOICE = 21;

    private WebView web;
    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private SpeechRecognizer recognizer;
    private boolean pendingVoice = false;

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

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int r = tts.setLanguage(new Locale("he", "IL"));
                ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            }
        });

        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        handleIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (tts != null) tts.shutdown();
        if (recognizer != null) recognizer.destroy();
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
            String id = key.endsWith("_e") || key.endsWith("_s") || key.endsWith("_n") ? key.substring(0, key.length() - 2) : key;
            final String js = "window.onNativeOpen&&window.onNativeOpen(" + JSONObject.quote(id) + ")";
            ui.postDelayed(() -> { if (web != null) web.evaluateJavascript(js, null); }, 600);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        js("window.onNativeEvents&&window.onNativeEvents()");
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

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (pendingVoice && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            pendingVoice = false;
            startVoiceNow();
        } else if (pendingVoice) {
            pendingVoice = false;
            js("window.onVoice&&window.onVoice(null,true,'no_permission')");
        }
        js("window.onPermsChanged&&window.onPermsChanged()");
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_VOICE) {
            String text = null;
            if (result == RESULT_OK && data != null) {
                ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (r != null && !r.isEmpty()) text = r.get(0);
            }
            js("window.onVoice&&window.onVoice(" + (text == null ? "null" : JSONObject.quote(text)) + ",true," + (text == null ? "'cancel'" : "null") + ")");
        }
    }

    void js(String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    /** Called from receivers: if the app is open, let the page pull events now. */
    static void notifyWeb() {
        MainActivity a = current.get();
        if (a == null) return;
        a.js("window.onNativeEvents&&window.onNativeEvents()");
    }

    // ---------------- voice ----------------
    private Intent voiceIntent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "he-IL");
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "he-IL");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "דבר — אני מקשיב");
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
        return i;
    }

    private void startVoiceNow() {
        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                recognizer.setRecognitionListener(new RecognitionListener() {
                    public void onReadyForSpeech(Bundle p) { js("window.onVoiceState&&window.onVoiceState('listening')"); }
                    public void onBeginningOfSpeech() {}
                    public void onRmsChanged(float v) {}
                    public void onBufferReceived(byte[] b) {}
                    public void onEndOfSpeech() { js("window.onVoiceState&&window.onVoiceState('processing')"); }
                    public void onError(int e) { js("window.onVoice&&window.onVoice(null,true,'err" + e + "')"); }
                    public void onResults(Bundle r) { deliver(r, true); }
                    public void onPartialResults(Bundle r) { deliver(r, false); }
                    public void onEvent(int t, Bundle p) {}
                });
            }
            recognizer.startListening(voiceIntent());
        } else {
            try { startActivityForResult(voiceIntent(), REQ_VOICE); }
            catch (Exception e) { js("window.onVoice&&window.onVoice(null,true,'unavailable')"); }
        }
    }

    private void deliver(Bundle r, boolean fin) {
        ArrayList<String> list = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String t = list != null && !list.isEmpty() ? list.get(0) : null;
        if (t == null && !fin) return;
        js("window.onVoice&&window.onVoice(" + (t == null ? "null" : JSONObject.quote(t)) + "," + fin + "," + (t == null ? "'empty'" : "null") + ")");
    }

    // ---------------- permissions ----------------
    private String[] permsFor(String name) {
        switch (name) {
            case "mic": return new String[]{Manifest.permission.RECORD_AUDIO};
            case "sms": return new String[]{Manifest.permission.SEND_SMS};
            case "phone": return new String[]{Manifest.permission.READ_PHONE_STATE};
            case "location": return new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
            case "bglocation": return new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION};
            case "bt": return Build.VERSION.SDK_INT >= 31 ? new String[]{Manifest.permission.BLUETOOTH_CONNECT} : new String[0];
            default: return new String[0];
        }
    }

    private boolean has(String name) {
        for (String p : permsFor(name)) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {}
    }

    class Bridge {
        @JavascriptInterface
        public void setAlarms(String json) {
            try { Alarms.setAll(MainActivity.this, new JSONArray(json)); } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setContext(String json) {
            try { Ctx.setAll(MainActivity.this, new JSONArray(json)); } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String takeEvents() { return Alarms.takeEvents(MainActivity.this); }

        @JavascriptInterface
        public void dismiss(String id) {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(Alarms.code(id));
        }

        @JavascriptInterface
        public String status() {
            JSONObject o = new JSONObject();
            try {
                boolean notif = ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled();
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                o.put("notifications", notif);
                o.put("exact", Alarms.canExact(MainActivity.this));
                o.put("battery", pm.isIgnoringBatteryOptimizations(getPackageName()));
                o.put("tts", ttsReady);
                for (String n : new String[]{"mic", "sms", "phone", "location", "bglocation", "bt"}) o.put(n, has(n));
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void requestPerm(String name) {
            ui.post(() -> {
                if (has(name)) { js("window.onPermsChanged&&window.onPermsChanged()"); return; }
                if ("bglocation".equals(name) && !has("location")) {
                    requestPermissions(permsFor("location"), REQ_PERMS);
                    return;
                }
                String[] p = permsFor(name);
                boolean askedBefore = Alarms.prefs(MainActivity.this).getBoolean("asked_" + name, false);
                boolean canAsk = false;
                for (String x : p) if (shouldShowRequestPermissionRationale(x)) canAsk = true;
                if (askedBefore && !canAsk && !"bglocation".equals(name)) { openAppSettings(); return; }
                Alarms.prefs(MainActivity.this).edit().putBoolean("asked_" + name, true).apply();
                requestPermissions(p, REQ_PERMS);
            });
        }

        @JavascriptInterface
        public void startVoice() {
            ui.post(() -> {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    pendingVoice = true;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERMS);
                } else startVoiceNow();
            });
        }

        @JavascriptInterface
        public void stopVoice() {
            ui.post(() -> { if (recognizer != null) recognizer.stopListening(); });
        }

        @JavascriptInterface
        public boolean speak(String text) {
            if (tts == null || !ttsReady) return false;
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "r" + System.currentTimeMillis());
            return true;
        }

        @JavascriptInterface
        public void openTtsSettings() {
            ui.post(() -> {
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); }
                catch (Exception e) {
                    try { startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)); } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public String btDevices() {
            JSONArray a = new JSONArray();
            try {
                if (!has("bt")) return a.toString();
                BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
                BluetoothAdapter ad = bm != null ? bm.getAdapter() : null;
                if (ad == null) return a.toString();
                for (BluetoothDevice d : ad.getBondedDevices()) {
                    JSONObject o = new JSONObject();
                    o.put("name", d.getName() == null ? d.getAddress() : d.getName());
                    o.put("addr", d.getAddress());
                    a.put(o);
                }
            } catch (Exception ignored) {}
            return a.toString();
        }

        @JavascriptInterface
        public void currentLocation() {
            ui.post(() -> {
                try {
                    if (!has("location")) { js("window.onLocation&&window.onLocation(null,'no_permission')"); return; }
                    LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                    String prov = lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
                    if (Build.VERSION.SDK_INT >= 30) {
                        lm.getCurrentLocation(prov, null, getMainExecutor(), loc -> sendLoc(loc != null ? loc : last(lm)));
                    } else {
                        sendLoc(last(lm));
                    }
                } catch (SecurityException e) {
                    js("window.onLocation&&window.onLocation(null,'no_permission')");
                } catch (Exception e) {
                    js("window.onLocation&&window.onLocation(null,'error')");
                }
            });
        }

        private Location last(LocationManager lm) {
            try {
                Location a = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                Location b = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (a == null) return b;
                if (b == null) return a;
                return a.getTime() > b.getTime() ? a : b;
            } catch (SecurityException e) { return null; }
        }

        private void sendLoc(Location l) {
            if (l == null) { js("window.onLocation&&window.onLocation(null,'unavailable')"); return; }
            js("window.onLocation&&window.onLocation({lat:" + l.getLatitude() + ",lng:" + l.getLongitude() + ",acc:" + l.getAccuracy() + "},null)");
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
    }
}
