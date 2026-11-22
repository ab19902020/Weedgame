package uk.greencounty.game;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the game in a WebView. Assets are served from a virtual https origin
 * (https://appassets.androidplatform.net/) so ES modules, workers, fetch() and WebGPU's
 * secure-context requirement work. On first launch of this version the old file:// origin's
 * localStorage save (prototype v0.3-v0.5) is read once and handed to the game.
 */
public class Main extends Activity {
  static final String ORIGIN = "https://appassets.androidplatform.net/";
  WebView web;
  SharedPreferences prefs;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    prefs = getSharedPreferences("gc", MODE_PRIVATE);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    web = new WebView(this);
    setContentView(web);
    immersive();
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(true);           // only used by the one-off legacy-save migration page
    s.setAllowContentAccess(false);
    web.addJavascriptInterface(new Bridge(), "GCNative");
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        String url = req.getUrl().toString();
        if (!url.startsWith(ORIGIN)) return null;
        String path = req.getUrl().getPath();
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        try {
          InputStream in = getAssets().open("www" + path);
          Map<String, String> h = new HashMap<>();
          h.put("Cache-Control", "no-cache");
          return new WebResourceResponse(mime(path), mime(path).startsWith("text") || mime(path).contains("javascript") ? "utf-8" : null, 200, "OK", h, in);
        } catch (Exception e) {
          return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
        }
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        String u = req.getUrl().toString();
        return !(u.startsWith(ORIGIN) || u.startsWith("file:///android_asset/"));
      }
    });
    if (!prefs.getBoolean("migrated06", false)) web.loadUrl("file:///android_asset/migrate.html");
    else web.loadUrl(ORIGIN + "index.html");
  }

  static String mime(String p) {
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js")) return "application/javascript";
    if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".jpg")) return "image/jpeg";
    return "application/octet-stream";
  }

  void immersive() {
    web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
  @Override protected void onPause() { super.onPause(); web.evaluateJavascript("window.GC&&GC.save&&GC.save.now()", null); web.onPause(); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }

  class Bridge {
    @JavascriptInterface public String legacySave() { return prefs.getString("legacySave", null); }
    @JavascriptInterface public void storeLegacy(String json) {
      SharedPreferences.Editor e = prefs.edit();
      if (json != null && json.length() > 2) e.putString("legacySave", json);
      e.putBoolean("migrated06", true).apply();
      runOnUiThread(() -> web.loadUrl(ORIGIN + "index.html"));
    }
    @JavascriptInterface public String savePerf(String json) {
      try {
        File dir = getExternalFilesDir(null);
        File f = new File(dir, "perf-" + System.currentTimeMillis() + ".json");
        FileOutputStream o = new FileOutputStream(f); o.write(json.getBytes("UTF-8")); o.close();
        return f.getAbsolutePath();
      } catch (Exception ex) { return "error: " + ex; }
    }
  }
}
