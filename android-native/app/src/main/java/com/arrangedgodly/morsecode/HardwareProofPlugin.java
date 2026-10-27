package com.arrangedgodly.morsecode;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HardwareProof")
public class HardwareProofPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().startActivity(new Intent(getContext(), HardwareTestActivity.class));
            call.resolve();
        });
    }
}
