// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.view.InputDevice;
import android.view.KeyEvent;
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
     * #1858: a generic gamepad's numbered buttons, forwarded to the page.
     *
     * <p>Android raises a generic pad's buttons as KEYCODE_BUTTON_1 to 16 (Generic.kl), and the
     * WebView passes those to the page in neither {@code gamepad.buttons} nor {@code keydown}
     * (spike 0027, #1819). So a key event whose code is one of them, from a joystick or a gamepad,
     * is sent to the page's {@code window.__oylGamepadButton} instead -- the button's number and
     * whether it went down -- and consumed: the WebView did nothing with it. A held button's
     * repeats are consumed and not sent; a release Android cancels, as a pad is unplugged, is
     * sent as a release. {@code apps/web/src/game/gamepad-port.ts} reads it.
     *
     * <p>⚠️ Every other key event -- the volume keys, a keyboard's keys, a named gamepad button
     * such as KEYCODE_BUTTON_A, a numbered code from anything but a pad -- takes the path it took
     * before, {@code super.dispatchKeyEvent}, untouched. The script is a constant plus a number
     * from 1 to 16 and a boolean, so nothing a page or a pad holds is ever written into it.
     *
     * <p>CI does not build Android: {@code apps/mobile/src/android/gamepad-button-source.test.ts}
     * reads this source and runs {@link #forwardedButton} over each class of key event; whether a
     * pad throws on a device is #1858's tablet step.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int button = forwardedButton(event.getKeyCode(), event.getSource());
        Bridge bridge = getBridge();
        if (button == 0 || bridge == null || bridge.getWebView() == null) {
            return super.dispatchKeyEvent(event);
        }
        int action = event.getAction();
        if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            forwardButton(bridge.getWebView(), button, true);
        } else if (action == KeyEvent.ACTION_UP) {
            forwardButton(bridge.getWebView(), button, false);
        }
        return true;
    }

    /**
     * The numbered button a key event is, from 1 to 16, or 0 for any event that is not forwarded:
     * one whose code is not KEYCODE_BUTTON_1 to 16, or whose source is neither a joystick nor a
     * gamepad. Bounded on this side as the page bounds it on its own (CLAUDE.md §6).
     */
    static int forwardedButton(int keyCode, int source) {
        if (keyCode < KeyEvent.KEYCODE_BUTTON_1 || keyCode > KeyEvent.KEYCODE_BUTTON_16) {
            return 0;
        }
        boolean joystick = (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
        boolean gamepad = (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD;
        if (!joystick && !gamepad) {
            return 0;
        }
        return keyCode - KeyEvent.KEYCODE_BUTTON_1 + 1;
    }

    private static void forwardButton(WebView webView, int button, boolean pressed) {
        webView.evaluateJavascript(
                "(function(){var f=window.__oylGamepadButton;"
                        + "try{if(typeof f==='function'){f("
                        + button
                        + ","
                        + (pressed ? "true" : "false")
                        + ");}}catch(e){}})()",
                null);
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
