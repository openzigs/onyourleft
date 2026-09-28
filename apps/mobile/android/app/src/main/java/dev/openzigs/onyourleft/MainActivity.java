// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * ⚠️ {@link RecordingServicePlugin} and {@link ThermalPlugin} (#247) are registered here, BEFORE
     * {@code super.onCreate}. Capacitor
     * auto-discovers plugins that ship as packages; one that lives in the application's own source
     * tree has to be registered by hand, and registering it after the bridge is built is a silent
     * no-op -- the web layer gets "plugin not implemented" at the moment a rider presses record.
     */
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(RecordingServicePlugin.class);
        registerPlugin(ThermalPlugin.class);
        super.onCreate(savedInstanceState);
        // #672: the WebView draws white until the page paints, which in the device's dark mode is a
        // white frame in a dark room. The page's canvas instead, per palette -- res/values and
        // res/values-night colors.xml. Not capacitor.config.ts's backgroundColor, which is ONE colour
        // for both palettes and so would be the wrong one in one of them.
        getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.oyl_canvas));
    }
}
