package uk.greencounty.game;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
public class Main extends Activity {
  public void onCreate(Bundle state){
    super.onCreate(state);
    getWindow().getDecorView().setSystemUiVisibility(5894);
    WebView game=new WebView(this);
    setContentView(game);
    game.getSettings().setJavaScriptEnabled(true);
    game.getSettings().setDomStorageEnabled(true);
    game.setWebViewClient(new WebViewClient(){
      public boolean shouldOverrideUrlLoading(WebView view,String url){return true;}
    });
    game.loadUrl("file:///android_asset/index.html");
  }
}
