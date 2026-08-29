package com.tabaaq.mobile.ui.scan

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.ui.theme.EmphasizedTypography
import com.tabaaq.mobile.ui.theme.Motion
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    viewModel: ScanViewModel,
    onBack: () -> Unit,
    onCreateFromScan: (ProductScanResult) -> Unit,
    onOpenProduct: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) {
        if (!granted) permission.launch(Manifest.permission.CAMERA)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.scan_label), style = EmphasizedTypography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                !granted -> {
                    Column(Modifier.align(Alignment.Center).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.camera_permission), style = MaterialTheme.typography.bodyLarge)
                        Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) {
                            Text(stringResource(R.string.allow_camera))
                        }
                    }
                }
                ui.result != null -> {
                    ScanReview(
                        ui = ui,
                        onRetake = viewModel::clearResult,
                        onCreate = { onCreateFromScan(requireNotNull(ui.result)) },
                        onOpenMatch = { ui.match?.let { onOpenProduct(it.id) } },
                    )
                }
                else -> {
                    CameraPane(
                        busy = ui.busy,
                        error = ui.error,
                        onCapture = viewModel::capture,
                    )
                }
            }
        }
    }
}

@Composable
private fun ScanReview(
    ui: ScanUi,
    onRetake: () -> Unit,
    onCreate: () -> Unit,
    onOpenMatch: () -> Unit,
) {
    val result = ui.result ?: return
    Column(
        Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.scan_review), style = MaterialTheme.typography.titleMedium)
        Text(result.name ?: stringResource(R.string.scan_unnamed), style = MaterialTheme.typography.headlineSmall)
        listOfNotNull(result.composition, result.strength, result.batchNumber, result.expiresAt)
            .forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        ui.match?.let { match ->
            Text(stringResource(R.string.scan_match, match.name), style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onOpenMatch, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.open_matched_product))
            }
        }
        FilledTonalButton(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.create_from_scan))
        }
        TextButton(onClick = onRetake) { Text(stringResource(R.string.retake_photo)) }
    }
}

@Composable
private fun CameraPane(
    busy: Boolean,
    error: String?,
    onCapture: (Bitmap) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val imageCapture = remember { ImageCapture.Builder().build() }
    DisposableEffect(Unit) {
        onDispose { executor.shutdown() }
    }
    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                val previewView =
                    PreviewView(viewContext).apply {
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                    }
                val cameraProviderFuture = ProcessCameraProvider.getInstance(viewContext)
                cameraProviderFuture.addListener(
                    {
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(lifecycleOwner, androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                    },
                    ContextCompat.getMainExecutor(viewContext),
                )
                previewView
            },
        )
        Column(
            Modifier.align(Alignment.BottomCenter).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            AnimatedVisibility(visible = busy, enter = fadeIn(Motion.enter()), exit = fadeOut(Motion.exit())) {
                CircularProgressIndicator()
            }
            Button(
                enabled = !busy,
                onClick = {
                    imageCapture.takePicture(
                        executor,
                        object : ImageCapture.OnImageCapturedCallback() {
                            override fun onCaptureSuccess(image: ImageProxy) {
                                val bitmap = image.toBitmap().rotate(image.imageInfo.rotationDegrees.toFloat())
                                image.close()
                                ContextCompat.getMainExecutor(context).execute { onCapture(bitmap) }
                            }

                            override fun onError(exception: ImageCaptureException) {
                                imageCapture
                            }
                        },
                    )
                },
            ) {
                Text(stringResource(R.string.capture_label))
            }
        }
    }
}

private fun Bitmap.rotate(degrees: Float): Bitmap {
    if (degrees == 0f) return this
    val matrix = Matrix().apply { postRotate(degrees) }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}
