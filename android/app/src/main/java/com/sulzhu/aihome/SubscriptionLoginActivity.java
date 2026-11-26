package com.sulzhu.aihome;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.*;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import java.net.InetSocketAddress;
import java.net.URL;
import org.json.JSONArray;

public final class SubscriptionLoginActivity extends Activity {
    private static boolean directoryReady;
    private WebView page;
    private boolean device;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            if (Build.VERSION.SDK_INT < 28) throw new Exception("当前系统无法隔离订阅登录代理");
            if (!directoryReady) {
                WebView.setDataDirectorySuffix("subscription_login");
                directoryReady = true;
            }
            URL url = new URL(getIntent().getStringExtra("url"));
            if (!"https".equals(url.getProtocol())) throw new Exception("授权页需要 HTTPS");
            InetSocketAddress proxy = (InetSocketAddress) ModelNetwork.subscriptionProxy(url).address();
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE))
                throw new Exception("系统 WebView 不支持订阅代理，请更新系统 WebView");
            String host = proxy.getHostString();
            if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
            ProxyConfig config = new ProxyConfig.Builder().addProxyRule("http://" + host + ":" + proxy.getPort()).removeImplicitRules().build();
            device = getIntent().getBooleanExtra("device", false);
            setTitle(device ? "授权码 " + getIntent().getStringExtra("userCode") + " · 完成后返回" : "订阅登录");
            if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);
            JSONArray callbacks = new JSONArray(getIntent().getStringExtra("callbacks"));
            page = new WebView(this);
            page.getSettings().setJavaScriptEnabled(true);
            page.getSettings().setDomStorageEnabled(true);
            if (!device) page.getSettings().setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
            CookieManager.getInstance().setAcceptThirdPartyCookies(page, true);
            page.getSettings().setAllowFileAccess(false);
            page.getSettings().setAllowContentAccess(false);
            page.setWebViewClient(new WebViewClient() {
                private boolean intercept(String target) {
                    String base = target.split("[?#]", 2)[0];
                    for (int i = 0; i < callbacks.length(); i++) {
                        if (base.equals(callbacks.optString(i))) {
                            setResult(RESULT_OK, new Intent().putExtra("callback", target));
                            finish();
                            return true;
                        }
                    }
                    return !target.startsWith("https://");
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    return req.isForMainFrame() && intercept(req.getUrl().toString());
                }
                @Override public void onPageStarted(WebView view, String target, android.graphics.Bitmap icon) {
                    if (intercept(target)) view.stopLoading();
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                    if (req.isForMainFrame() && !isFinishing()) fail("经订阅代理打开授权页失败：" + error.getDescription());
                }
            });
            setContentView(page);
            ProxyController.getInstance().setProxyOverride(config, this::runOnUiThread, () -> {
                if (!isFinishing() && !isDestroyed()) page.loadUrl(url.toString());
            });
        } catch (Exception e) { fail(e.getMessage()); }
    }

    private void fail(String reason) {
        setResult(RESULT_CANCELED, new Intent().putExtra("error", reason));
        finish();
    }
    @Override public boolean onOptionsItemSelected(android.view.MenuItem item) {
        if (item.getItemId() == android.R.id.home) { onBackPressed(); return true; }
        return super.onOptionsItemSelected(item);
    }
    @Override public void onBackPressed() {
        if (device) setResult(RESULT_OK, new Intent());
        finish();
    }
    @Override protected void onDestroy() {
        if (page != null) { page.stopLoading(); page.destroy(); }
        super.onDestroy();
    }
}
