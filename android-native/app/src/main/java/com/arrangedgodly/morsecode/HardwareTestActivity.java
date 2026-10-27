package com.arrangedgodly.morsecode;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.lifecycle.Lifecycle;
import com.google.common.util.concurrent.ListenableFuture;

// A native hardware proof, deliberately separate from the web Morse receiver.
public class HardwareTestActivity extends AppCompatActivity {
    private PreviewView preview;
    private TextView status;
    private TextView details;
    private Button flashlightButton;
    private ProcessCameraProvider provider;
    private Camera camera;
    private CameraManager cameraManager;
    private String flashlightCameraId;
    private boolean flashlightOn;
    private boolean previewWanted;
    private int generation;
    private int permissionAction;
    private int resumeAction;

    private final ActivityResultLauncher<String> permission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            int action = permissionAction;
            permissionAction = 0;
            updateDetails();
            if (granted) {
                if (getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) perform(action);
                else resumeAction = action;
            } else {
                status.setText(R.string.permission_blocked);
            }
        });

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.hardware_test);
        View root = findViewById(R.id.hardware_root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        preview = findViewById(R.id.native_preview);
        preview.setVisibility(View.INVISIBLE);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        status = findViewById(R.id.hardware_status);
        details = findViewById(R.id.hardware_details);
        flashlightButton = findViewById(R.id.flashlight_test);
        cameraManager = getSystemService(CameraManager.class);
        findViewById(R.id.preview_test).setOnClickListener(v -> requestAction(1));
        flashlightButton.setOnClickListener(v -> requestAction(2));
        findViewById(R.id.stop_hardware).setOnClickListener(v -> stopHardware());
        findViewById(R.id.app_settings).setOnClickListener(v -> startActivity(
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        findViewById(R.id.close_hardware).setOnClickListener(v -> finish());
        preview.getPreviewStreamState().observe(this, stream -> {
            if (previewWanted && stream == PreviewView.StreamState.STREAMING) {
                status.setText(R.string.preview_live);
            }
        });
        status.setText(R.string.hardware_idle);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateDetails();
    }

    @Override
    protected void onPostResume() {
        super.onPostResume();
        if (resumeAction != 0) {
            int action = resumeAction;
            resumeAction = 0;
            perform(action);
        }
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private void updateDetails() {
        details.setText(getString(R.string.hardware_details, Build.MANUFACTURER + " " + Build.MODEL,
            Build.VERSION.RELEASE, Build.VERSION.SDK_INT,
            hasPermission() ? "granted" : "not granted"));
    }

    private void requestAction(int action) {
        if (permissionAction != 0) return;
        if (!hasPermission()) {
            permissionAction = action;
            permission.launch(Manifest.permission.CAMERA);
        } else {
            perform(action);
        }
    }

    private void perform(int action) {
        updateDetails();
        if (action == 1) startPreview();
        if (action == 2) toggleFlashlight();
    }

    private void startPreview() {
        stopHardware();
        preview.setVisibility(View.VISIBLE);
        previewWanted = true;
        int request = ++generation;
        status.setText(R.string.preview_starting);
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            if (request != generation || !previewWanted || !getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) return;
            try {
                provider = future.get();
                Preview useCase = new Preview.Builder().build();
                useCase.setSurfaceProvider(preview.getSurfaceProvider());
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, useCase);
                camera.getCameraInfo().getCameraState().observe(this, state -> {
                    if (request == generation && state.getError() != null) {
                        status.setText(getString(R.string.camera_error_code, state.getError().getCode()));
                    }
                });
            } catch (Exception error) {
                stopHardware();
                showError(error);
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private String findFlashlight() throws Exception {
        for (String id : cameraManager.getCameraIdList()) {
            CameraCharacteristics info = cameraManager.getCameraCharacteristics(id);
            Integer lens = info.get(CameraCharacteristics.LENS_FACING);
            if (Boolean.TRUE.equals(info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)) &&
                lens != null && lens == CameraCharacteristics.LENS_FACING_BACK) return id;
        }
        return null;
    }

    private void toggleFlashlight() {
        boolean next = !flashlightOn;
        int request = generation;
        try {
            if (camera != null) {
                if (!camera.getCameraInfo().hasFlashUnit()) {
                    status.setText(R.string.no_flashlight);
                    return;
                }
                flashlightButton.setEnabled(false);
                ListenableFuture<Void> future = camera.getCameraControl().enableTorch(next);
                future.addListener(() -> {
                    if (request != generation) return;
                    flashlightButton.setEnabled(true);
                    try {
                        future.get();
                        showFlashlight(next);
                    } catch (Exception error) {
                        showError(error);
                    }
                }, ContextCompat.getMainExecutor(this));
            } else {
                if (previewWanted) {
                    status.setText(R.string.preview_starting);
                    return;
                }
                flashlightCameraId = findFlashlight();
                if (flashlightCameraId == null) {
                    status.setText(R.string.no_flashlight);
                    return;
                }
                cameraManager.setTorchMode(flashlightCameraId, next);
                showFlashlight(next);
            }
        } catch (Exception error) {
            showError(error);
        }
    }

    private void showFlashlight(boolean on) {
        flashlightOn = on;
        flashlightButton.setText(on ? R.string.flashlight_off : R.string.flashlight_on);
        status.setText(on ? R.string.flashlight_is_on : R.string.flashlight_is_off);
    }

    private void showError(Exception error) {
        status.setText(getString(R.string.hardware_error, error.getClass().getSimpleName(), error.getMessage()));
    }

    private void stopHardware() {
        generation++;
        previewWanted = false;
        preview.setVisibility(View.INVISIBLE);
        if (camera != null) camera.getCameraControl().enableTorch(false);
        if (provider != null) provider.unbindAll();
        camera = null;
        Exception stopError = null;
        if (flashlightCameraId != null) {
            try {
                cameraManager.setTorchMode(flashlightCameraId, false);
                flashlightCameraId = null;
            } catch (Exception error) {
                stopError = error;
            }
        }
        flashlightOn = false;
        flashlightButton.setEnabled(true);
        flashlightButton.setText(R.string.flashlight_on);
        status.setText(R.string.hardware_stopped);
        if (stopError != null) showError(stopError);
    }

    @Override
    protected void onStop() {
        stopHardware();
        super.onStop();
    }
}
