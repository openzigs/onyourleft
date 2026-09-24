// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android's thermal forecast, for the game's quality ladder (#247).
 *
 * <p>One method and no state. {@code apps/mobile/src/thermal/thermal.ts} is the other side of this
 * bridge and {@code apps/web/src/game/thermal.ts} decides how often it is asked.
 *
 * <p>The reply is {@code { supported, headroom? }}:
 *
 * <ul>
 *   <li>{@code supported: false} below API 30, where {@link PowerManager#getThermalHeadroom} does
 *       not exist. The minimum SDK is 24, so this branch is reachable.
 *   <li>{@code headroom} is <b>omitted</b> when the platform answers {@code NaN}. {@link
 *       JSObject#put(String, double)} is {@code JSONObject}'s, which throws on a non-finite value,
 *       and JSON has no spelling for NaN. The TypeScript side puts the NaN back, so the web
 *       client's "NaN is passed through unchanged" still holds.
 * </ul>
 *
 * <p>⚠️ <b>Uncompiled.</b> It was written where no Android SDK was available, the same limit {@code
 * apps/mobile/README.md} §4 records for the rest of this project. Validation 0002 Part E is where
 * it is first run.
 */
@CapacitorPlugin(name = "Thermal")
public class ThermalPlugin extends Plugin {

    /** {@code getThermalHeadroom} accepts a forecast of 0 to 60 seconds. */
    private static final int MAXIMUM_FORECAST_SECONDS = 60;

    @PluginMethod
    public void headroom(PluginCall call) {
        JSObject reply = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            reply.put("supported", false);
            call.resolve(reply);
            return;
        }
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (power == null) {
            reply.put("supported", false);
            call.resolve(reply);
            return;
        }
        int forecast = call.getInt("forecastSeconds", 10);
        forecast = Math.max(0, Math.min(MAXIMUM_FORECAST_SECONDS, forecast));
        float headroom = power.getThermalHeadroom(forecast);
        reply.put("supported", true);
        if (!Float.isNaN(headroom) && !Float.isInfinite(headroom)) {
            reply.put("headroom", (double) headroom);
        }
        call.resolve(reply);
    }
}
