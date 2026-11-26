package com.sulzhu.aihome;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/**
 * Keeps an in-flight assistant generation alive when the WebView is backgrounded.
 * The existing WebView stream/tool loop remains the single execution path; this
 * foreground service raises process priority so switching apps or locking the
 * screen does not intentionally tear down that in-flight generation.
 */
public final class GenerationService extends Service {
    public static final String ACTION_START = "com.sulzhu.aihome.generation.START";
    public static final String ACTION_STOP = "com.sulzhu.aihome.generation.STOP";
    private static final int FOREGROUND_ID = 73001;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final java.util.Map<String, Runnable> handoffTimeouts = new java.util.HashMap<>();
    private static GenerationService active;
    // A short request can finish before the queued service start reaches onStartCommand.
    // Keep that stop until its matching owner has been registered and promoted.
    private static final java.util.Set<String> pendingStarts = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private static final java.util.Set<String> cancelledStarts = java.util.concurrent.ConcurrentHashMap.newKeySet();

    static void expect(String owner) { if (owner != null && !owner.isEmpty()) pendingStarts.add(owner); }
    static void forget(String owner) {
        pendingStarts.remove(owner);
        cancelledStarts.remove(owner);
    }
    // Insertion order lets the notification return to the previous live
    // conversation when the latest generation finishes.
    private final java.util.LinkedHashMap<String, Intent> owners = new java.util.LinkedHashMap<>();

    private void clearHandoff(String owner) {
        Runnable timeout = handoffTimeouts.remove(owner);
        if (timeout != null) handler.removeCallbacks(timeout);
    }

    static void release(String owner) {
        GenerationService service = active;
        if (owner == null || owner.isEmpty()) return;
        if (service != null) service.clearHandoff(owner);
        if (service == null || service.owners.remove(owner) == null) {
            if (pendingStarts.contains(owner)) cancelledStarts.add(owner);
            return;
        }
        if (service.owners.isEmpty()) {
            service.releaseWakeLock();
            service.stopForeground(true);
            service.stopSelf();
            Log.i("AiHome:gen", "fgs_stopped");
        } else {
            Intent previous = null;
            for (Intent running : service.owners.values()) previous = running;
            if (previous != null) service.showOwner(previous);
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) return;
            if (!wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignored) { }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) { }
    }

    @Override public void onCreate() {
        super.onCreate();
        active = this;
        SystemNotifier.ensureGenerationChannel(this);
        // 锁屏后 CPU 可能休眠：partial wake lock 只阻止深度休眠，不点亮屏幕、不改后台网络架构。
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aihome:generation");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) { }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            release(intent == null ? "" : intent.getStringExtra("messageId"));
            return START_NOT_STICKY;
        }
        String owner = intent == null ? "" : intent.getStringExtra("messageId");
        if (owner == null || owner.isEmpty()) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        pendingStarts.remove(owner);
        // A fast WebView may claim the run before this alarm intent is handled.
        // Never downgrade an active generation to a timed handoff.
        if (intent.getBooleanExtra("alarmPending", false)
                && owners.containsKey(owner)
                && !owners.get(owner).getBooleanExtra("alarmPending", false)) return START_NOT_STICKY;
        clearHandoff(owner);
        if (intent.getBooleanExtra("alarmPending", false)) {
            Runnable timeout = () -> {
                Log.w("AiHome:gen", "task_handoff_timeout runId=" + owner);
                release(owner);
            };
            handoffTimeouts.put(owner, timeout);
            handler.postDelayed(timeout, 60000);
        }
        owners.remove(owner);
        owners.put(owner, new Intent(intent));
        showOwner(intent);
        if (cancelledStarts.remove(owner)) release(owner);
        // The WebView owns the actual request. Recreating only this service
        // would show a stale “generating” notification without resuming it.
        return START_NOT_STICKY;
    }

    private void showOwner(Intent intent) {
        String assistant = intent == null ? "" : intent.getStringExtra("assistantName");
        if (assistant == null || assistant.trim().isEmpty()) assistant = "栖间";
        String assistantId = intent == null ? "" : intent.getStringExtra("assistantId");
        String conversationId = intent == null ? "" : intent.getStringExtra("conversationId");

        int contentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) contentFlags |= PendingIntent.FLAG_IMMUTABLE;
        // 点击整条通知：回到 App 并切到正在生成的会话。
        Intent click = new Intent(this, MainActivity.class);
        click.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        click.putExtra(SystemNotifier.EXTRA_FROM_NOTIFICATION, true);
        try {
            JSONObject payload = new JSONObject();
            payload.put("assistantId", assistantId == null ? "" : assistantId);
            payload.put("conversationId", conversationId == null ? "" : conversationId);
            payload.put("kind", "generation");
            click.putExtra(SystemNotifier.EXTRA_PAYLOAD, payload.toString());
        } catch (Exception ignored) { }
        PendingIntent content = PendingIntent.getActivity(this, FOREGROUND_ID, click, contentFlags);

        boolean pending = intent != null && intent.getBooleanExtra("alarmPending", false);
        Notification n = new NotificationCompat.Builder(this, SystemNotifier.GENERATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_aihome)
            .setContentTitle(assistant + (pending ? " 准备执行任务" : " 正在回复"))
            .setContentText(pending ? "正在交接给助手" : "切到后台也会继续生成")
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        startForeground(FOREGROUND_ID, n);
        acquireWakeLock();
        Log.i("AiHome:gen", "fgs_started assistant=" + assistant + " count=" + owners.size()
            + " wakelock=" + (wakeLock != null && wakeLock.isHeld()));
    }

    @Override public void onDestroy() {
        if (active == this) active = null;
        owners.clear();
        for (Runnable timeout : handoffTimeouts.values()) handler.removeCallbacks(timeout);
        handoffTimeouts.clear();
        releaseWakeLock();
        stopForeground(true);
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
