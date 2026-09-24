// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
 */
@CapacitorPlugin(name = "RecordingService")
public class RecordingServicePlugin extends Plugin {

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
