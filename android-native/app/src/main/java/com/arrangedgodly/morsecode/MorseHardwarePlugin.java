package com.arrangedgodly.morsecode;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.graphics.Rect;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Range;
import android.view.View;
import android.widget.FrameLayout;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraState;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.Observer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "MorseHardware", permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
})
@androidx.annotation.OptIn(markerClass = ExperimentalCamera2Interop.class)
public class MorseHardwarePlugin extends Plugin {
    private final Object timelineToken = new Object();
    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private HandlerThread lightThread;
    private Handler lightHandler;
    private CameraManager manager;
    private volatile String flashlightId;
    private volatile long txSession;
    private volatile long stoppedTx;
    private volatile long txGeneration;
    private volatile long rxSession;
    private long stoppedRx;
    private long epoch;
    private ProcessCameraProvider provider;
    private ImageAnalysis analysis;
    private PreviewView preview;
    private FrameLayout container;
    private long presented;
    private LiveData<CameraState> cameraState;
    private Observer<CameraState> cameraObserver;

    @Override
    public void load() {
        manager = getContext().getSystemService(CameraManager.class);
        lightThread = new HandlerThread("MorseFlashlight");
        lightThread.start();
        lightHandler = new Handler(lightThread.getLooper());
    }

    private void withPermission(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getPermissionState("camera") == PermissionState.GRANTED) permitted(call);
            else {
                call.getData().put("permissionEpoch", epoch);
                requestPermissionForAlias("camera", call, "permissionResult");
            }
        });
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.resolve(new JSObject().put("ok", false).put("outcome", "permission-denied"));
        } else if (call.getLong("permissionEpoch", -1L) != epoch) {
            call.resolve(new JSObject().put("ok", false).put("outcome", "cancelled"));
        } else permitted(call);
    }

    private void permitted(PluginCall call) {
        if ("startReceiver".equals(call.getMethodName())) openReceiver(call);
        else armFlashlight(call);
    }

    @PluginMethod
    public void acquireFlashlight(PluginCall call) { withPermission(call); }

    private String rearCamera(boolean requireFlash) throws Exception {
        for (String id : manager.getCameraIdList()) {
            CameraCharacteristics info = manager.getCameraCharacteristics(id);
            Integer facing = info.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK &&
                (!requireFlash || Boolean.TRUE.equals(info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)))) return id;
        }
        return null;
    }

    private void armFlashlight(PluginCall call) {
        long session = call.getLong("session", 0L);
        if (session <= stoppedTx) {
            call.resolve(new JSObject().put("ok", false).put("outcome", "cancelled"));
            return;
        }
        closeReceiver();
        try {
            String id = rearCamera(true);
            if (id == null) {
                call.resolve(new JSObject().put("ok", false).put("outcome", "no-flashlight"));
                return;
            }
            txSession = session;
            flashlightId = id;
            lightHandler.post(() -> {
                if (txSession != session || session <= stoppedTx) {
                    call.resolve(new JSObject().put("ok", false).put("outcome", "cancelled"));
                    return;
                }
                try {
                    manager.setTorchMode(id, false);
                    call.resolve(new JSObject().put("ok", true));
                } catch (Exception error) { call.reject(error.toString()); }
            });
        } catch (Exception error) { call.reject(error.toString()); }
    }

    private void cancelTimeline() {
        txGeneration++;
        lightHandler.removeCallbacksAndMessages(timelineToken);
    }

    private void light(boolean on, long session, long generation) {
        if (session != txSession || session <= stoppedTx || generation != txGeneration) return;
        try {
            manager.setTorchMode(flashlightId, on);
        } catch (Exception error) {
            cancelTimeline();
            notifyListeners("hardwareLost", new JSObject().put("source", "flashlight")
                .put("session", session).put("detail", error.toString()));
        }
    }

    @PluginMethod
    public void setFlashlight(PluginCall call) {
        long session = call.getLong("session", 0L);
        if (session != txSession || session <= stoppedTx || flashlightId == null) {
            call.reject("Flashlight session is no longer active");
            return;
        }
        cancelTimeline();
        long generation = txGeneration;
        lightHandler.post(() -> {
            light(Boolean.TRUE.equals(call.getBoolean("on", false)), session, generation);
            call.resolve();
        });
    }

    @PluginMethod
    public void scheduleFlashlight(PluginCall call) {
        long session = call.getLong("session", 0L);
        if (session != txSession || session <= stoppedTx || flashlightId == null) {
            call.reject("Flashlight session is no longer active");
            return;
        }
        try {
            JSONArray events = call.getArray("events");
            double position = call.getDouble("positionMs", 0.0);
            double delay = call.getDouble("delayMs", 0.0);
            if (events == null || events.length() > 20000 || !Double.isFinite(position) || position < 0 ||
                !Double.isFinite(delay) || delay < 0 || delay > 10000) throw new IllegalArgumentException("Invalid timeline");
            // Validate the whole timeline before enqueuing any hardware operation.
            double previous = -1;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                double time = event.getDouble("tMs");
                event.getBoolean("on");
                if (!Double.isFinite(time) || time < previous || time < 0 || time > 3600000) {
                    throw new IllegalArgumentException("Invalid timeline edge");
                }
                previous = time;
            }
            cancelTimeline();
            long generation = txGeneration;
            long anchor = SystemClock.uptimeMillis() + Math.round(delay);
            boolean atPosition = false;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                double time = event.getDouble("tMs");
                boolean on = event.getBoolean("on");
                if (time <= position) atPosition = on;
                if (time >= position) {
                    lightHandler.postAtTime(() -> light(on, session, generation), timelineToken,
                        anchor + Math.round(time - position));
                }
            }
            if (position > 0) {
                boolean restore = atPosition;
                lightHandler.postAtTime(() -> light(restore, session, generation), timelineToken, anchor);
            }
            call.resolve();
        } catch (Exception error) { call.reject(error.toString()); }
    }

    private void flashlightOff(boolean release) {
        cancelTimeline();
        String id = flashlightId;
        if (release) {
            stoppedTx = Math.max(stoppedTx, txSession);
            flashlightId = null;
        }
        if (id != null) lightHandler.post(() -> {
            try { manager.setTorchMode(id, false); }
            catch (Exception error) {
                notifyListeners("hardwareLost", new JSObject().put("source", "flashlight")
                    .put("session", txSession).put("detail", error.toString()));
            }
        });
    }

    @PluginMethod
    public void releaseFlashlight(PluginCall call) {
        long session = call.getLong("session", 0L);
        stoppedTx = Math.max(stoppedTx, session);
        if (txSession == session) flashlightOff(true);
        call.resolve();
    }

    @PluginMethod
    public void startReceiver(PluginCall call) { withPermission(call); }

    @PluginMethod
    public void openSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    private void openReceiver(PluginCall call) {
        long session = call.getLong("session", 0L);
        if (session <= stoppedRx) {
            call.resolve(new JSObject().put("ok", false).put("outcome", "cancelled"));
            return;
        }
        closeReceiver();
        flashlightOff(true);
        rxSession = session;
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            if (rxSession != session || session <= stoppedRx) {
                call.resolve(new JSObject().put("ok", false).put("outcome", "cancelled"));
                return;
            }
            try {
                String id = rearCamera(false);
                if (id == null) throw new IllegalStateException("No rear camera found");
                provider = future.get();
                container = getActivity().findViewById(android.R.id.content);
                preview = new PreviewView(getContext());
                preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
                preview.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                preview.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                container.addView(preview, new FrameLayout.LayoutParams(1, 1));
                placePreview(call);
                Preview view = new Preview.Builder().build();
                view.setSurfaceProvider(preview.getSurfaceProvider());
                ImageAnalysis.Builder builder = new ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST);
                configureExposure(builder, manager.getCameraCharacteristics(id));
                analysis = builder.build();
                presented = 0;
                analysis.setAnalyzer(analysisExecutor, image -> sample(image, session));
                CameraSelector selector = new CameraSelector.Builder()
                    .requireLensFacing(CameraSelector.LENS_FACING_BACK)
                    .addCameraFilter(infos -> {
                        for (androidx.camera.core.CameraInfo info : infos) {
                            if (Camera2CameraInfo.from(info).getCameraId().equals(id)) return Collections.singletonList(info);
                        }
                        return Collections.emptyList();
                    }).build();
                Camera camera = provider.bindToLifecycle(getActivity(), selector, view, analysis);
                cameraState = camera.getCameraInfo().getCameraState();
                cameraObserver = state -> {
                    if (rxSession == session && state.getError() != null) {
                        notifyListeners("hardwareLost", new JSObject().put("source", "camera")
                            .put("session", session).put("detail", "Camera error " + state.getError().getCode()));
                    }
                };
                cameraState.observe(getActivity(), cameraObserver);
                call.resolve(new JSObject().put("ok", true));
            } catch (Exception error) {
                closeReceiver();
                call.reject(error.toString());
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void configureExposure(ImageAnalysis.Builder builder, CameraCharacteristics info) {
        Camera2Interop.Extender<ImageAnalysis> controls = new Camera2Interop.Extender<>(builder);
        int[] capabilities = info.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
        boolean manual = false;
        if (capabilities != null) for (int capability : capabilities) {
            if (capability == CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR) manual = true;
        }
        Range<Long> exposure = info.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE);
        Range<Integer> sensitivity = info.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
        if (manual && exposure != null && sensitivity != null) {
            controls.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF);
            controls.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, exposure.clamp(5000000L));
            controls.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, sensitivity.clamp(200));
            controls.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, 33333333L);
        }
    }

    private void sample(ImageProxy image, long session) {
        try {
            if (rxSession != session) return;
            ImageProxy.PlaneProxy plane = image.getPlanes()[0];
            ByteBuffer bytes = plane.getBuffer();
            Rect crop = image.getCropRect();
            double[] levels = new double[64];
            int clipped = 0;
            // Only 32x32 luminance samples leave the camera plane, aggregated to 8x8 tiles.
            for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
                int px = crop.left + Math.min(crop.width() - 1, (2 * x + 1) * crop.width() / 64);
                int py = crop.top + Math.min(crop.height() - 1, (2 * y + 1) * crop.height() / 64);
                int raw = bytes.get(py * plane.getRowStride() + px * plane.getPixelStride()) & 255;
                double luma = Math.max(0, Math.min(255, (raw - 16) * 255.0 / 219));
                levels[(y / 4) * 8 + x / 4] += luma / 16;
                if (luma >= 250) clipped++;
            }
            JSArray tiles = new JSArray();
            for (double level : levels) tiles.put(level);
            if (rxSession == session) notifyListeners("cameraFrame", new JSObject()
                .put("session", session).put("tMs", image.getImageInfo().getTimestamp() / 1000000.0)
                .put("presented", ++presented).put("levels", tiles).put("clippingFraction", clipped / 1024.0));
        } catch (Exception error) {
            if (rxSession == session) notifyListeners("hardwareLost", new JSObject().put("source", "camera")
                .put("session", session).put("detail", error.toString()));
        } finally { image.close(); }
    }

    private void placePreview(PluginCall call) {
        if (preview == null) return;
        double scale = call.getDouble("scale", 1.0);
        if (!Double.isFinite(scale) || scale <= 0 || scale > 10) return;
        int[] web = new int[2];
        int[] parent = new int[2];
        getBridge().getWebView().getLocationOnScreen(web);
        container.getLocationOnScreen(parent);
        FrameLayout.LayoutParams box = new FrameLayout.LayoutParams(
            Math.max(1, (int) Math.round(call.getDouble("width", 1.0) * scale)),
            Math.max(1, (int) Math.round(call.getDouble("height", 1.0) * scale)));
        box.leftMargin = web[0] - parent[0] + (int) Math.round(call.getDouble("left", 0.0) * scale);
        box.topMargin = web[1] - parent[1] + (int) Math.round(call.getDouble("top", 0.0) * scale);
        preview.setLayoutParams(box);
    }

    @PluginMethod
    public void positionPreview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (call.getLong("session", 0L) == rxSession) placePreview(call);
            call.resolve();
        });
    }

    private void closeReceiver() {
        stoppedRx = Math.max(stoppedRx, rxSession);
        rxSession = 0;
        if (cameraState != null && cameraObserver != null) cameraState.removeObserver(cameraObserver);
        cameraState = null;
        cameraObserver = null;
        if (analysis != null) analysis.clearAnalyzer();
        if (provider != null) provider.unbindAll();
        if (preview != null && container != null) container.removeView(preview);
        preview = null;
        analysis = null;
    }

    @PluginMethod
    public void stopReceiver(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            long session = call.getLong("session", 0L);
            stoppedRx = Math.max(stoppedRx, session);
            if (rxSession == session) closeReceiver();
            call.resolve();
        });
    }

    @Override
    protected void handleOnStop() {
        epoch++;
        closeReceiver();
        flashlightOff(false);
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        getActivity().runOnUiThread(() -> {
            epoch++;
            closeReceiver();
            flashlightOff(true);
        });
        return null;
    }

    @Override
    protected void handleOnDestroy() {
        closeReceiver();
        flashlightOff(true);
        lightHandler.post(() -> lightThread.quitSafely());
        analysisExecutor.shutdown();
    }
}
