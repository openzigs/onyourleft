// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

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
 */
@CapacitorPlugin(name = "RecordingService")
public class RecordingServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        RecordingService.start(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RecordingService.stop(getContext());
        call.resolve();
    }
}
