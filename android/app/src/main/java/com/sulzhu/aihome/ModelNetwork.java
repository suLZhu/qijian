package com.sulzhu.aihome;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.URL;
import java.util.List;

final class ModelNetwork {
    private ModelNetwork() {}

    static HttpURLConnection open(URL target, String policy) throws Exception {
        boolean subscription = "subscription".equals(policy);
        if (!subscription && !"direct".equals(policy)) throw new IOException("未知的模型网络策略");
        if (!"https".equalsIgnoreCase(target.getProtocol())
                && (subscription || !"http".equalsIgnoreCase(target.getProtocol()))) {
            throw new IOException(subscription ? "订阅接口需要 HTTPS" : "模型接口需要 HTTP 或 HTTPS");
        }
        Proxy route = Proxy.NO_PROXY;
        if (subscription) {
            ProxySelector selector = ProxySelector.getDefault();
            List<Proxy> candidates = selector == null ? null : selector.select(target.toURI());
            if (candidates != null) {
                for (Proxy candidate : candidates) {
                    if (candidate != null && candidate.type() == Proxy.Type.HTTP) {
                        route = candidate;
                        break;
                    }
                }
            }
            if (route == Proxy.NO_PROXY) throw new IOException("Android 未为此订阅接口配置 HTTP 代理");
        }
        HttpURLConnection connection = (HttpURLConnection) target.openConnection(route);
        connection.setInstanceFollowRedirects(false);
        return connection;
    }
}
