package com.arrangedgodly.morsecode;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(HardwareProofPlugin.class);
        super.onCreate(state);
    }
}
