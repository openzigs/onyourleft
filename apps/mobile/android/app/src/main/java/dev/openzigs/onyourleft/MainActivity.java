// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * ⚠️ {@link RecordingServicePlugin}, {@link ThermalPlugin} (#247) and {@link SecureWindowPlugin}
     * (#1061) are registered here, BEFORE
     * {@code super.onCreate}. Capacitor
     * auto-discovers plugins that ship as packages; one that lives in the application's own source
     * tree has to be registered by hand, and registering it after the bridge is built is a silent
     * no-op -- the web layer gets "plugin not implemented" at the moment a rider presses record.
     */
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(RecordingServicePlugin.class);
        registerPlugin(ThermalPlugin.class);
        registerPlugin(SecureWindowPlugin.class);
        super.onCreate(savedInstanceState);
        // #672: the WebView draws white until the page paints, which in the device's dark mode is a
        // white frame in a dark room. The page's canvas instead, per palette -- res/values and
        // res/values-night colors.xml. Not capacitor.config.ts's backgroundColor, which is ONE colour
        // for both palettes and so would be the wrong one in one of them.
        // ⚠️ Guarded: when no WebView can be inflated (disabled, mid-update, absent on a de-Googled
        // ROM) Capacitor 8.5.2's BridgeActivity.onCreate shows its no_webview screen and returns
        // BEFORE load(), so there is no bridge -- and an unguarded call crashed that screen at launch.
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.oyl_canvas));
            getOnBackPressedDispatcher().addCallback(this, new AskThePage(bridge.getWebView()));
        }
    }

    /**
     * #1512: Android's back gesture or button, asked of the page before anything else happens.
     *
     * <p>Without it {@code BridgeActivity} takes Android's default and leaves the app from every
     * screen. This takes every press and calls the page's {@code window.__oylAndroidBack} with the
     * one fact only the WebView knows, whether its own history can go back --
     * {@code apps/web/src/shell/android-back.ts} decides the rest: in-app back, nothing at all while
     * a ride is on, and leaving only from Home. The script is a constant plus that one boolean, so
     * nothing a page holds is ever written into it.
     *
     * <p>Only a literal {@code true} answer keeps the rider in the app. Anything else -- no page yet,
     * no function, a page that threw -- falls through to Android's default, so a broken page can
     * never trap a rider in the app. The fall-through disables this callback for that one dispatch,
     * which is how {@code OnBackPressedDispatcher} reaches the activity's own default.
     *
     * <p>CI does not build Android: {@code apps/mobile/src/android/back-source.test.ts} reads this
     * source, and whether a device's back behaves is a check on the owner's list (#733).
     */
    private final class AskThePage extends OnBackPressedCallback {

        private final WebView webView;

        AskThePage(WebView webView) {
            super(true);
            this.webView = webView;
        }

        @Override
        public void handleOnBackPressed() {
            String canGoBack = webView.canGoBack() ? "true" : "false";
            webView.evaluateJavascript(
                    "(function(){var f=window.__oylAndroidBack;"
                            + "try{return typeof f==='function'&&f("
                            + canGoBack
                            + ")===true;}catch(e){return false;}})()",
                    answer -> {
                        if (!"true".equals(answer)) {
                            leave();
                        }
                    });
        }

        private void leave() {
            setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
            setEnabled(true);
        }
    }
}
