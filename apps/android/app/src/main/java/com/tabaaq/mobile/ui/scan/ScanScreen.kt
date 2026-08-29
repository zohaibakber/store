package com.tabaaq.mobile.ui.scan

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.ui.theme.AppMotion
import com.tabaaq.mobile.ui.theme.EmphasizedTypography
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
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
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) {
        if (!granted) permission.launch(Manifest.permission.CAMERA)
    }

    Scaffold { padding ->
        val stage =
            when {
                !granted -> ScanStage.Permission
                ui.result != null -> ScanStage.Review
                else -> ScanStage.Camera
            }
        Box(Modifier.fillMaxSize().padding(padding)) {
            AnimatedContent(
                targetState = stage,
                transitionSpec = {
                    (fadeIn(AppMotion.defaultEffects()) + scaleIn(AppMotion.defaultSpatial(), initialScale = 0.96f)) togetherWith
                        (fadeOut(AppMotion.fastEffects()) + scaleOut(AppMotion.fastSpatial(), targetScale = 0.98f))
                },
                label = "Scan stage",
            ) { currentStage ->
                when (currentStage) {
                    ScanStage.Permission -> {
                    CameraPermission(onRequest = { permission.launch(Manifest.permission.CAMERA) })
                    }
                    ScanStage.Review -> {
                        ScanReview(
                            ui = ui,
                            onRetake = viewModel::clearResult,
                            onCreate = { onCreateFromScan(requireNotNull(ui.result)) },
                            onOpenMatch = { ui.match?.let { onOpenProduct(it.id) } },
                        )
                    }
                    ScanStage.Camera -> {
                        CameraPane(
                            busy = ui.busy,
                            error = ui.error,
                            onCapture = viewModel::capture,
                        )
                    }
                }
            }
            IconButton(
                onClick = onBack,
                modifier = Modifier.align(Alignment.TopStart).padding(4.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                )
            }
        }
    }
}

private enum class ScanStage {
    Permission,
    Camera,
    Review,
}

@Composable
private fun CameraPermission(onRequest: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            shape = MaterialTheme.shapes.extraLarge,
        ) {
            Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PhotoCamera, contentDescription = null, modifier = Modifier.size(34.dp))
            }
        }
        Spacer(Modifier.size(20.dp))
        Text(stringResource(R.string.camera_permission), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.size(16.dp))
        Button(onClick = onRequest, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.allow_camera))
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
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shape = MaterialTheme.shapes.extraLarge,
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            color = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.CheckCircle, contentDescription = null)
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(R.string.scan_ready), style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        result.name ?: stringResource(R.string.scan_unnamed),
                        style = EmphasizedTypography.headlineSmall,
                    )
                    Text(
                        stringResource(R.string.scan_review),
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.72f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    result.composition?.let {
                        ResultRow(stringResource(R.string.composition_label), it)
                    }
                    result.strength?.let {
                        ResultRow(stringResource(R.string.strength_label), it)
                    }
                    result.batchNumber?.let {
                        ResultRow(stringResource(R.string.batch_number), it)
                    }
                    result.expiresAt?.let {
                        ResultRow(stringResource(R.string.expiry_date), it)
                    }
                }
            }
        }
        ui.match?.let { match ->
            item {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    shape = MaterialTheme.shapes.large,
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(R.string.scan_match, match.name), style = MaterialTheme.typography.titleSmall)
                        FilledTonalButton(onClick = onOpenMatch, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.open_matched_product))
                        }
                    }
                }
            }
        }
        item {
            Button(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.DocumentScanner, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.create_from_scan))
            }
        }
        item {
            OutlinedButton(onClick = onRetake, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.retake_photo))
            }
        }
    }
}

@Composable
private fun ResultRow(
    label: String,
    value: String,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.width(16.dp))
        Text(value, style = MaterialTheme.typography.titleSmall)
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
    val surfaceRequests = remember { MutableStateFlow<SurfaceRequest?>(null) }
    val surfaceRequest by surfaceRequests.collectAsStateWithLifecycle()
    val spatialSpec = AppMotion.fastSpatial<Float>()
    val effectsSpec = AppMotion.fastEffects<Float>()
    val captureScale by
        animateFloatAsState(
            targetValue = if (busy) 0.88f else 1f,
            animationSpec = spatialSpec,
            label = "Capture button scale",
        )
    DisposableEffect(Unit) {
        onDispose { executor.shutdown() }
    }
    LaunchedEffect(lifecycleOwner) {
        val cameraProvider = ProcessCameraProvider.awaitInstance(context)
        val preview =
            Preview.Builder().build().apply {
                setSurfaceProvider { request -> surfaceRequests.value = request }
            }
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            imageCapture,
        )
        try {
            awaitCancellation()
        } finally {
            cameraProvider.unbindAll()
        }
    }
    Box(Modifier.fillMaxSize()) {
        surfaceRequest?.let { request ->
            CameraXViewfinder(
                surfaceRequest = request,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Surface(
            modifier = Modifier.align(Alignment.TopCenter).padding(20.dp),
            color = Color.Black.copy(alpha = 0.58f),
            contentColor = Color.White,
            shape = MaterialTheme.shapes.large,
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(stringResource(R.string.scan_guidance), style = MaterialTheme.typography.titleSmall)
                Text(
                    stringResource(R.string.scan_guidance_detail),
                    color = Color.White.copy(alpha = 0.74f),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Box(
            Modifier
                .align(Alignment.Center)
                .fillMaxWidth(0.82f)
                .aspectRatio(1.3f)
                .border(
                    BorderStroke(2.dp, Color.White.copy(alpha = 0.88f)),
                    MaterialTheme.shapes.extraLarge,
                ),
        )
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            error?.let {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(it, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                }
            }
            AnimatedVisibility(
                visible = busy,
                enter = fadeIn(effectsSpec) + scaleIn(spatialSpec, initialScale = 0.92f),
                exit = fadeOut(effectsSpec) + scaleOut(spatialSpec, targetScale = 0.92f),
            ) {
                Surface(
                    color = Color.Black.copy(alpha = 0.62f),
                    contentColor = Color.White,
                    shape = MaterialTheme.shapes.large,
                ) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.scanning_product))
                    }
                }
            }
            LargeFloatingActionButton(
                onClick = {
                    if (busy) return@LargeFloatingActionButton
                    imageCapture.takePicture(
                        executor,
                        object : ImageCapture.OnImageCapturedCallback() {
                            override fun onCaptureSuccess(image: ImageProxy) {
                                val bitmap = image.toBitmap().rotate(image.imageInfo.rotationDegrees.toFloat())
                                image.close()
                                ContextCompat.getMainExecutor(context).execute { onCapture(bitmap) }
                            }

                            override fun onError(exception: ImageCaptureException) = Unit
                        },
                    )
                },
                modifier =
                    Modifier
                        .size(76.dp)
                        .graphicsLayer {
                            scaleX = captureScale
                            scaleY = captureScale
                            alpha = if (busy) 0.72f else 1f
                        },
                shape = androidx.compose.foundation.shape.CircleShape,
                containerColor = Color.White,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(
                    Icons.Outlined.PhotoCamera,
                    contentDescription = stringResource(R.string.capture_label),
                    modifier = Modifier.size(32.dp),
                )
            }
        }
    }
}

private fun Bitmap.rotate(degrees: Float): Bitmap {
    if (degrees == 0f) return this
    val matrix = Matrix().apply { postRotate(degrees) }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}
