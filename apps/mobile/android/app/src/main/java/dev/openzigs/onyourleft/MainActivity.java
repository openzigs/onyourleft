// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * ⚠️ {@link RecordingServicePlugin} is registered here, BEFORE {@code super.onCreate}. Capacitor
     * auto-discovers plugins that ship as packages; one that lives in the application's own source
     * tree has to be registered by hand, and registering it after the bridge is built is a silent
     * no-op -- the web layer gets "plugin not implemented" at the moment a rider presses record.
     */
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(RecordingServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
