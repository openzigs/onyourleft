// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * The connectedDevice foreground service (#87).
 *
 * <p>Its whole job is to keep <em>this process</em> alive and out of Doze while a ride is being
 * recorded, so that the BLE links the plugin holds stay up and the recorder in the WebView keeps
 * receiving samples. It deliberately owns no GATT client of its own: the connections belong to
 * {@code @capacitor-community/bluetooth-le}, which already serialises every operation through an
 * internal queue, and a second GATT client here would spend a handle out of the OS-wide budget of
 * about 30 for nothing.
 *
 * <p>⚠️ <b>What this cannot do, stated here rather than discovered later.</b> #87's fourth
 * acceptance criterion asks that killing the renderer not stop recording. In a Capacitor shell the
 * recorder is {@code packages/domain}'s state machine running as JavaScript inside the WebView, so
 * the renderer <em>is</em> the recorder: if the WebView process dies, recording stops, and no
 * foreground service can change that. Satisfying that criterion means porting the recording engine
 * to native code and giving up #85's premise that the shell wraps the same web build. That is a
 * decision for an ADR, not something to be quietly half-implemented here. What this service does
 * buy is the far more common case: the screen off, the app backgrounded, and the system looking for
 * something to reclaim.
 *
 * <p>The service is started with {@code startForeground} within the window Android allows and is
 * declared {@code android:foregroundServiceType="connectedDevice"} in the manifest. Since Android 14
 * (API 34) both are mandatory: a missing manifest type throws
 * {@code MissingForegroundServiceTypeException} and a missing
 * {@code FOREGROUND_SERVICE_CONNECTED_DEVICE} permission throws {@code SecurityException}. Neither
 * is a warning.
 */
public class RecordingService extends Service {

    /** Also used by {@link RecordingServicePlugin}; a mismatch would be a silent no-op. */
    public static final String ACTION_START = "dev.openzigs.onyourleft.action.START_RECORDING";

    public static final String ACTION_STOP = "dev.openzigs.onyourleft.action.STOP_RECORDING";

    private static final String CHANNEL_ID = "ride_recording";

    private static final int NOTIFICATION_ID = 1;

    /**
     * Not bound. The web layer talks to this through {@link RecordingServicePlugin}'s start and stop
     * intents, which is a narrower seam than a Binder and one that survives the Activity being
     * recreated.
     */
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return Service.START_NOT_STICKY;
        }

        createChannel();
        final Notification notification = buildNotification();

        // The three-argument form is required from API 29 and is the one that carries the type; the
        // two-argument form on 34+ throws rather than defaulting.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // NOT START_STICKY. A restarted service would come back with a null intent and no ride: it
        // would show a "Recording ride" notification over nothing being recorded, which is a lie to
        // the rider and the shape of bug that survives for months. If the process dies the ride is
        // recovered from the checkpoints #46 writes, not from a resurrected notification.
        return Service.START_NOT_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        final NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        final NotificationChannel channel =
            new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.recording_channel_name),
                // LOW, so the ongoing notification does not make a sound every time it is posted.
                // It is a status line, not an alert.
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.recording_channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        final Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        final PendingIntent contentIntent =
            PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.recording_notification_title))
            .setContentText(getString(R.string.recording_notification_text))
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            // The notification says a ride is being recorded and nothing about where it is. A
            // lock-screen line naming a place would defeat ADR 0004 for the sake of a nicety.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    /** Start helper, so the action strings live in exactly one file. */
    public static void start(Context context) {
        final Intent intent = new Intent(context, RecordingService.class);
        intent.setAction(ACTION_START);
        context.startForegroundService(intent);
    }

    /** Stop helper. Idempotent: stopping a service that is not running is not an error. */
    public static void stop(Context context) {
        final Intent intent = new Intent(context, RecordingService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }
}
