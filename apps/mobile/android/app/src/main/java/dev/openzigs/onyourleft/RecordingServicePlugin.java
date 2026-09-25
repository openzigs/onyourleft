// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The bridge between the web client's recording state machine and {@link RecordingService} (#87).
 *
 * <p>Two methods and no state. The service is the thing that keeps the process alive; this class
 * only says when. Deliberately not a bound service: a Binder would have to survive the Activity
 * being recreated on a rotation or a configuration change, and start/stop intents do that for free.
 *
 * <p>⚠️ <b>Neither method reports whether the service actually came up</b>, and that is a real
 * limit rather than an oversight. {@code startForegroundService} is asynchronous, and the failure
 * that matters -- an OEM battery optimiser killing the process minutes later -- happens long after
 * this call has resolved. A {@code resolve()} here means "the system accepted the request", nothing
 * more, and the TypeScript side names it that way so no screen can claim otherwise.
 *
 * <p>⚠️ <b>#524: nothing called this until then.</b> {@code apps/mobile/src/recording/} is the
 * TypeScript side, and the ride controller asks for the service while a ride is active. Both
 * refusals below reject rather than throw, and the controller records the ride anyway.
 *
 * <p>⚠️ <b>#526: the notification permission is asked for HERE, through Capacitor's permission
 * API.</b> From API 33 {@code POST_NOTIFICATIONS} is a runtime permission, so declaring it in the
 * manifest is not enough and the service's "Recording ride" notification was never shown. The two
 * methods below answer {@code apps/web/src/ride/notification-permission-port.ts}; WHEN to ask is the
 * web client's decision ({@code ride/controller.ts} §{@code askAboutTheNotification}) and this
 * class only reports and asks. The request goes through {@link #requestPermissionForAlias} and a
 * {@link PermissionCallback} rather than an {@code ActivityCompat} call outside the bridge, so the
 * answer arrives on the same {@link PluginCall} and survives the Activity being recreated.
 */
@CapacitorPlugin(
    name = "RecordingService",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = RecordingServicePlugin.NOTIFICATIONS)
    }
)
public class RecordingServicePlugin extends Plugin {

    /** The alias the {@code @Permission} above declares {@code POST_NOTIFICATIONS} under. */
    static final String NOTIFICATIONS = "notifications";

    /** API 33, where {@code POST_NOTIFICATIONS} became a runtime permission. */
    private static final int NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION = 33;

    /**
     * Whether the ride's notification may be shown, WITHOUT asking: {@code { state }}, one of
     * Capacitor's {@code granted}, {@code denied}, {@code prompt}, {@code prompt-with-rationale}.
     */
    @PluginMethod
    public void notificationPermission(PluginCall call) {
        call.resolve(notificationAnswer());
    }

    /**
     * Ask Android for {@code POST_NOTIFICATIONS}, and answer with the state afterwards.
     *
     * <p>⚠️ Below API 33 NOTHING is asked: the permission is granted at install there, and {@code
     * checkSelfPermission} on a permission the platform does not know answers "denied", which would
     * put a dialog that cannot appear in front of a rider -- so {@link #notificationAnswer} reports
     * {@code granted} before Capacitor's own state is ever read.
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION
            || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(notificationAnswer());
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionAnswered");
    }

    @PermissionCallback
    private void notificationPermissionAnswered(PluginCall call) {
        call.resolve(notificationAnswer());
    }

    private JSObject notificationAnswer() {
        JSObject answer = new JSObject();
        if (Build.VERSION.SDK_INT < NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION) {
            answer.put("state", PermissionState.GRANTED.toString());
            return answer;
        }
        PermissionState state = getPermissionState(NOTIFICATIONS);
        answer.put("state", (state == null ? PermissionState.PROMPT : state).toString());
        return answer;
    }

    @PluginMethod
    public void start(PluginCall call) {
        // From API 34 a connectedDevice service may only be started with a Bluetooth runtime
        // permission granted, and without one startForeground throws SecurityException inside the
        // service -- an uncaught crash of the whole app. A rider can start recording before ever
        // pairing a sensor, which is before anything asked for that permission.
        if (Build.VERSION.SDK_INT >= 34
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("The Bluetooth permission is not granted, so the recording service cannot start");
            return;
        }
        try {
            RecordingService.start(getContext());
        } catch (IllegalStateException refused) {
            // ForegroundServiceStartNotAllowedException (API 31+) is an IllegalStateException: the
            // app was not allowed to start a foreground service at this moment.
            call.reject("Android did not allow the recording service to start", refused);
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RecordingService.stop(getContext());
        call.resolve();
    }
}
