package com.arrangedgodly.morsecode;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(HardwareProofPlugin.class);
        registerPlugin(MorseHardwarePlugin.class);
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                bridge.getWebView().evaluateJavascript("window.morseNativeBack?.() === true", handled -> {
                    if ("true".equals(handled)) return;
                    if (bridge.getWebView().canGoBack()) bridge.getWebView().goBack();
                    else finish();
                });
            }
        });
    }
}
