package uk.greencounty.game;

import android.app.Activity;
import android.app.GameManager;
import android.os.Build;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.InputDevice;
import android.os.CombinedVibration;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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
          if(path.endsWith(".mp4"))return episode(path, req.getRequestHeaders().get("Range"));
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

  private WebResourceResponse episode(String path, String range) throws java.io.IOException {
    android.content.res.AssetFileDescriptor asset = getAssets().openFd("www"+path);
    long size=asset.getLength(), start=0, end=size-1;
    Map<String,String> headers=new HashMap<>();
    headers.put("Accept-Ranges","bytes");
    if(range!=null){
      try {
        if(!range.matches("bytes=[0-9]+-[0-9]*"))throw new NumberFormatException();
        String[] pair=range.substring(6).split("-",-1);
        start=Long.parseLong(pair[0]);
        if(!pair[1].isEmpty())end=Math.min(end,Long.parseLong(pair[1]));
        if(start>end)throw new NumberFormatException();
      }catch(NumberFormatException invalid){
        asset.close();headers.put("Content-Range","bytes */"+size);
        return new WebResourceResponse("video/mp4",null,416,"Range Not Satisfiable",headers,null);
      }
      headers.put("Content-Range","bytes "+start+"-"+end+"/"+size);
    }
    long length=end-start+1;
    headers.put("Content-Length",Long.toString(length));
    android.content.res.AssetFileDescriptor slice=new android.content.res.AssetFileDescriptor(
        asset.getParcelFileDescriptor(),asset.getStartOffset()+start,length);
    return new WebResourceResponse("video/mp4",null,range==null?200:206,range==null?"OK":"Partial Content",headers,slice.createInputStream());
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
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) {
    immersive();
    web.evaluateJavascript("window.dispatchEvent(new Event('gcdevicechange'))", null);
  } }
  @Override protected void onPause() { super.onPause(); web.evaluateJavascript("window.GC&&GC.save&&GC.save.now()", null); web.onPause(); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }

  class Bridge {
    @JavascriptInterface public String gameMode() {
      if (Build.VERSION.SDK_INT >= 31) {
        GameManager manager = getSystemService(GameManager.class);
        if (manager != null) switch (manager.getGameMode()) {
          case GameManager.GAME_MODE_PERFORMANCE: return "performance";
          case GameManager.GAME_MODE_BATTERY: return "battery";
          case GameManager.GAME_MODE_STANDARD: return "standard";
          case 4: return "custom";
          default: break;
        }
      }
      return "unavailable";
    }
    @JavascriptInterface public String chipset() { return Build.VERSION.SDK_INT >= 31 ? Build.SOC_MODEL : ""; }
    @JavascriptInterface public float refreshRate() { return getWindowManager().getDefaultDisplay().getRefreshRate(); }
    @JavascriptInterface public String legacySave() { return prefs.getString("legacySave", null); }
    @JavascriptInterface public void storeLegacy(String json) {
      SharedPreferences.Editor e = prefs.edit();
      if (json != null && json.length() > 2) e.putString("legacySave", json);
      e.putBoolean("migrated06", true).apply();
      runOnUiThread(new Runnable() { public void run() { web.loadUrl(ORIGIN + "index.html"); } });   // (no lambdas: plain dx)
    }
    // a game controller's own rumble motors (DualShock 4, DualSense or any pad with them, over Bluetooth or USB):
    // strong is the low, heavy motor, weak the high one, 0..1, for ms milliseconds. False when there's no pad that can
    @JavascriptInterface public boolean rumble(float strong, float weak, int ms) {
      if (Build.VERSION.SDK_INT < 26 || ms <= 0) return false;
      int a = Math.round(Math.max(0f, Math.min(1f, strong)) * 255), b = Math.round(Math.max(0f, Math.min(1f, weak)) * 255);
      for (int id : InputDevice.getDeviceIds()) {
        InputDevice d = InputDevice.getDevice(id);
        if (d == null) continue;
        int src = d.getSources();
        if ((src & InputDevice.SOURCE_GAMEPAD) != InputDevice.SOURCE_GAMEPAD && (src & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK) continue;
        try {
          if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = d.getVibratorManager();
            int[] ids = vm.getVibratorIds();
            if (ids.length == 0) continue;
            if (a == 0 && b == 0) { vm.cancel(); return true; }
            if (ids.length >= 2) {
              CombinedVibration.ParallelCombination c = CombinedVibration.startParallel();
              if (a > 0) c.addVibrator(ids[0], VibrationEffect.createOneShot(ms, a));
              if (b > 0) c.addVibrator(ids[1], VibrationEffect.createOneShot(ms, b));
              vm.vibrate(c.combine());
            } else vm.vibrate(CombinedVibration.createParallel(VibrationEffect.createOneShot(ms, Math.max(a, b))));
            return true;
          }
          Vibrator v = d.getVibrator();
          if (v != null && v.hasVibrator()) { v.vibrate(VibrationEffect.createOneShot(ms, Math.max(1, Math.max(a, b)))); return true; }
        } catch (Exception ex) { /* a pad that won't rumble */ }
      }
      return false;
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
