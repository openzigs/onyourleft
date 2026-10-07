// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android's secure window flag, while a camera picture is on screen (#1061, ADR 0044 D-12).
 *
 * <p>Two methods and no state: {@code secure} adds {@link WindowManager.LayoutParams#FLAG_SECURE}
 * to the activity's window and {@code clear} clears it, each on the UI thread, which is the only
 * thread allowed to change a window's flags. While it is set Android shows a blank recent-apps
 * thumbnail, refuses a screenshot or a screen recording, and shows a non-secure display (a cast)
 * blank. {@code apps/mobile/src/secure-window/secure-window.ts} is the other side of this bridge,
 * and {@code apps/web/src/camera/secure-window.ts} decides when: a count over the pictures on
 * screen, never cleared on the way to the background.
 *
 * <p>It takes no argument, reads nothing and returns nothing but success, so nothing a page sends
 * can make it do anything but these two things.
 *
 * <p>⚠️ CI does not build Android. Whether a real device's thumbnail is blank is a device check on
 * the owner's list (#733).
 */
@CapacitorPlugin(name = "SecureWindow")
public class SecureWindowPlugin extends Plugin {

    @PluginMethod
    public void secure(PluginCall call) {
        change(call, true);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        change(call, false);
    }

    private void change(PluginCall call, boolean secure) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(
                () -> {
                    if (secure) {
                        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    } else {
                        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    }
                    call.resolve();
                });
    }
}
