package com.sulzhu.aihome;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.atomic.AtomicBoolean;

final class AppUpdates {
    private static final String RELEASES = "https://github.com/suLZhu/qijian/releases/download/";
    private static final String MIME = "application/vnd.android.package-archive";
    private final MainActivity activity;
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile Release release;

    AppUpdates(MainActivity activity) { this.activity = activity; }

    static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private PackageInfo installed(int flags) throws PackageManager.NameNotFoundException {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), flags);
    }

    String version() {
        try {
            PackageInfo info = installed(0);
            return new JSONObject().put("versionName", info.versionName).put("versionCode", versionCode(info)).toString();
        } catch (Exception e) { return "{}"; }
    }

    private void emit(JSONObject state) {
        activity.runOnUiThread(() -> activity.evalJs("window.dispatchEvent(new CustomEvent('qijian:app-update',{detail:JSON.parse("
            + JSONObject.quote(state.toString()) + ")}))"));
    }

    private void state(String status, String message) {
        try { emit(new JSONObject().put("status", status).put("message", message)); }
        catch (Exception ignored) { }
    }

    private void run(Runnable task) {
        if (!busy.compareAndSet(false, true)) return;
        new Thread(() -> {
            try { task.run(); }
            finally { busy.set(false); }
        }, "qijian-apk-update").start();
    }

    private record Release(long code, String name, String url, String sha, long size, String notes) {}

    void check(String channel) {
        if (!"stable".equals(channel) && !"beta".equals(channel)) return;
        run(() -> {
            release = null;
            state("checking", "正在检查更新…");
            HttpURLConnection connection = null;
            try {
                String base = RELEASES + "qijian-" + channel + "/";
                connection = (HttpURLConnection) new URL(base + "latest.json").openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setUseCaches(false);
                int status = connection.getResponseCode();
                if (!"https".equals(connection.getURL().getProtocol())) throw new SecurityException("更新地址必须使用 HTTPS");
                if (status == 404) { state("current", "此渠道暂无可用更新"); return; }
                if (status != 200) throw new IllegalStateException("HTTP " + status);
                byte[] payload;
                try (InputStream stream = connection.getInputStream()) {
                    java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[2048];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (output.size() + count > 32768) throw new IllegalArgumentException("更新清单过大");
                        output.write(buffer, 0, count);
                    }
                    payload = output.toByteArray();
                }
                JSONObject metadata = new JSONObject(new String(payload, StandardCharsets.UTF_8));
                long code = metadata.getLong("versionCode");
                String name = metadata.getString("versionName");
                String url = metadata.getString("apkUrl");
                String sha = metadata.getString("sha256");
                long size = metadata.getLong("sizeBytes");
                String notes = metadata.getString("notes");
                if (code <= 0 || name.trim().isEmpty() || size <= 0 || size > 300_000_000
                    || !sha.matches("[a-f0-9]{64}") || !url.equals(base + "qijian-" + code + ".apk")
                    || !channel.equals(metadata.getString("channel")) || !activity.getPackageName().equals(metadata.getString("applicationId"))) {
                    throw new IllegalArgumentException("更新清单无效");
                }
                if (code <= versionCode(installed(0))) { state("current", "已是当前渠道最新版本"); return; }
                release = new Release(code, name, url, sha, size, notes);
                emit(new JSONObject().put("status", "available").put("name", name).put("code", code).put("size", size).put("notes", notes));
            } catch (Exception e) { state("checkError", "检查更新失败，请稍后重试"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    void download() {
        run(() -> {
            Release target = release;
            if (target == null) { state("checkError", "请先检查更新"); return; }
            try {
                if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.runOnUiThread(() -> activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName()))));
                    state("retry", "请允许栖间安装应用，返回后再点下载更新");
                    return;
                }
                File root = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (root == null) throw new IllegalStateException("下载目录不可用");
                File apk = new File(root, "qijian-" + target.code + ".apk");
                DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                var prefs = activity.getSharedPreferences("qijian.apk.update", Context.MODE_PRIVATE);
                String key = target.sha;
                long id = prefs.getLong(key, -1);
                if (id < 0 && !apk.isFile()) {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(target.url))
                        .setTitle("栖间 " + target.name).setMimeType(MIME)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                        .setDestinationUri(Uri.fromFile(apk));
                    id = dm.enqueue(request);
                    prefs.edit().putLong(key, id).apply();
                }
                if (id >= 0) {
                    long deadline = android.os.SystemClock.elapsedRealtime() + 600_000L;
                    while (true) {
                        try (Cursor row = dm.query(new DownloadManager.Query().setFilterById(id))) {
                            if (row == null || !row.moveToFirst()) {
                                prefs.edit().remove(key).apply();
                                apk.delete();
                                throw new IllegalStateException("下载任务不存在，请重试");
                            }
                            int status = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                            if (status == DownloadManager.STATUS_SUCCESSFUL) break;
                            if (status == DownloadManager.STATUS_FAILED) {
                                dm.remove(id);
                                prefs.edit().remove(key).apply();
                                apk.delete();
                                throw new IllegalStateException("下载失败，请重试");
                            }
                            long bytes = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                            emit(new JSONObject().put("status", "downloading").put("progress", Math.min(100, bytes * 100 / target.size)));
                        }
                        if (android.os.SystemClock.elapsedRealtime() >= deadline) {
                            state("retry", "下载仍在后台进行，可点下载更新继续查看进度");
                            return;
                        }
                        Thread.sleep(800);
                    }
                }
                try { verify(apk, target); }
                catch (Exception invalid) {
                    if (id >= 0) dm.remove(id);
                    prefs.edit().remove(key).apply();
                    apk.delete();
                    throw invalid;
                }
                activity.runOnUiThread(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                        activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, MIME)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                        state("retry", "请在系统界面确认安装。取消后可再次点下载更新");
                    } catch (Exception e) { state("retry", "无法打开系统安装器，请重试"); }
                });
            } catch (Exception e) { state("retry", e.getMessage() == null ? "更新失败，请重试" : e.getMessage()); }
        });
    }

    private void verify(File apk, Release target) throws Exception {
        if (apk.length() != target.size) throw new SecurityException("安装包大小不符");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream stream = new FileInputStream(apk)) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = stream.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder sha = new StringBuilder();
        for (byte value : digest.digest()) sha.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        if (!sha.toString().equals(target.sha)) throw new SecurityException("安装包 SHA-256 校验失败");
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo current = installed(flags);
        PackageInfo candidate = activity.getPackageManager().getPackageArchiveInfo(apk.getPath(), flags);
        if (candidate == null || !current.packageName.equals(candidate.packageName)
            || versionCode(candidate) != target.code || target.code <= versionCode(current)) {
            throw new SecurityException("安装包名或版本号不匹配");
        }
        Signature[] expected = signers(current);
        Signature[] actual = signers(candidate);
        if (expected == null || actual == null || expected.length == 0
            || !new HashSet<>(Arrays.asList(expected)).equals(new HashSet<>(Arrays.asList(actual)))) {
            throw new SecurityException("安装包签名不匹配，已停止安装");
        }
    }

    private static Signature[] signers(PackageInfo info) {
        if (Build.VERSION.SDK_INT < 28) return info.signatures;
        return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
    }
}
