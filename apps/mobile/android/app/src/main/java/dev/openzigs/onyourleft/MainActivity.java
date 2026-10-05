// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

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
        }
    }
}
