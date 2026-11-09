// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.app.Activity;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Whether the shell's WebView lets media start without a user gesture -- #2357, the owner's
 * ruling of 2026-11-08 that the menus' music starts in the Android app with no first tap.
 *
 * <p>One method and no state: {@code allowed} answers {@code { allowed }}, the negation of the
 * WebView's own {@code getMediaPlaybackRequiresUserGesture()}, read on the UI thread, which is the
 * WebView's thread. Capacitor's {@code Bridge.initWebView} turns that setting off and
 * {@link MainActivity} says so again; this reads what the WebView actually has, so the page's
 * answer is the platform's, never a guess from the user agent.
 * {@code apps/mobile/src/autoplay/autoplay.ts} is the other side of this bridge, and
 * {@code apps/web/src/shell/menu-music.ts} decides what to do with it.
 *
 * <p>It takes no argument and changes nothing, so nothing a page sends can make it do anything
 * but answer.
 *
 * <p>CI does not build Android: {@code apps/mobile/src/android/autoplay-source.test.ts} reads
 * this source. Whether the loop is heard with no tap is #2357's tablet check.
 */
@CapacitorPlugin(name = "Autoplay")
public class AutoplayPlugin extends Plugin {

    @PluginMethod
    public void allowed(PluginCall call) {
        Activity activity = getActivity();
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (activity == null || webView == null) {
            call.reject("No WebView");
            return;
        }
        activity.runOnUiThread(
                () -> {
                    JSObject answer = new JSObject();
                    answer.put("allowed", !webView.getSettings().getMediaPlaybackRequiresUserGesture());
                    call.resolve(answer);
                });
    }
}
