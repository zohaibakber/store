package com.tabaaq.mobile.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.catalog.CatalogBatch
import com.tabaaq.mobile.core.catalog.MoneyFormat
import com.tabaaq.mobile.core.scan.ScanNormalize
import com.tabaaq.mobile.ui.components.ListSheet
import com.tabaaq.mobile.ui.components.listSheetRowColors
import com.tabaaq.mobile.ui.components.listSheetShape
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(
    viewModel: ProductDetailViewModel,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val product = ui.product
    val quantitySheetState = rememberModalBottomSheetState()
    val detailsSheetState = rememberModalBottomSheetState()
    val tracksPacks = product?.tracksPacks != false
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    if (product != null) {
                        FilledIconButton(
                            onClick = {
                                if (tracksPacks) viewModel.openDetails(null) else viewModel.openQuantity(null)
                            },
                        ) {
                            Icon(
                                Icons.Outlined.Add,
                                contentDescription =
                                    stringResource(if (tracksPacks) R.string.add_batch else R.string.add_stock),
                            )
                        }
                    }
                },
                windowInsets = WindowInsets(top = contentPadding.calculateTopPadding()),
            )
        },
    ) { padding ->
        if (product == null) {
            Column(Modifier.padding(padding).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.product_missing), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }
            }
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shape = MaterialTheme.shapes.extraLarge,
            ) {
                Row(
                    Modifier.padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Inventory2, contentDescription = null, modifier = Modifier.size(26.dp))
                        }
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(product.name, style = EmphasizedTypography.headlineSmall)
                        if (product.details.isNotBlank()) {
                            Text(
                                product.details,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.72f),
                            )
                        }
                        if (!product.visible) {
                            Text(stringResource(R.string.filter_hidden), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(stringResource(R.string.in_stock), style = MaterialTheme.typography.labelMedium)
                        Text(product.stockLabel, style = EmphasizedTypography.titleMedium)
                    }
                }
            }
            ui.error?.let {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(it, modifier = Modifier.padding(14.dp))
                }
            }
            ui.notice?.let {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(it, modifier = Modifier.padding(14.dp))
                }
            }
            ListSheet {
                val rows = productDetailRows(product)
                rows.forEachIndexed { index, (label, value) ->
                    ListItem(
                        modifier = Modifier.clip(listSheetShape(index, rows.size)),
                        colors = listSheetRowColors(),
                        headlineContent = { Text(label) },
                        trailingContent = {
                            Text(
                                value,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        },
                    )
                }
            }
            Text(
                stringResource(if (product.tracksPacks) R.string.batches_section else R.string.stock_section),
                style = MaterialTheme.typography.titleMedium,
            )
            if (product.batches.isEmpty()) {
                Text(
                    stringResource(if (product.tracksPacks) R.string.no_batches else R.string.no_stock),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            product.batches.forEach { batch ->
                Card(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(
                            color = MaterialTheme.colorScheme.secondaryContainer,
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Layers, contentDescription = null)
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (product.tracksPacks) {
                                    batch.batchNumber ?: stringResource(R.string.unnamed_batch)
                                } else {
                                    batchExpiryLabel(batch)
                                },
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                if (product.tracksPacks) {
                                    listOf(batchStockLabel(batch, true), batchExpiryLabel(batch)).joinToString(" · ")
                                } else {
                                    batchStockLabel(batch, false)
                                },
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(top = 4.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = { viewModel.openDetails(batch.id) }) {
                            Text(stringResource(R.string.edit_batch))
                        }
                        TextButton(onClick = { viewModel.openQuantity(batch.id) }) {
                            Text(stringResource(R.string.edit_quantity))
                        }
                    }
                }
            }
        }
    }
    if (ui.quantityOpen) {
        ModalBottomSheet(
            onDismissRequest = viewModel::closeSheets,
            sheetState = quantitySheetState,
            sheetGesturesEnabled = true,
        ) {
            Column(
                Modifier
                    .imePadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(if (product?.tracksPacks == true) R.string.edit_quantity else R.string.add_stock),
                    style = MaterialTheme.typography.titleMedium,
                )
                if (product?.tracksPacks == true) {
                    OutlinedTextField(
                        ui.packQuantity,
                        viewModel::setPackQuantity,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.pack_quantity)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    OutlinedTextField(
                        ui.unitQuantity,
                        viewModel::setUnitQuantity,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.unit_quantity)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                } else {
                    OutlinedTextField(
                        ui.unitQuantity,
                        viewModel::setUnitQuantity,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.quantity_label)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    OutlinedTextField(
                        ui.expiresOn,
                        viewModel::setExpiresOn,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.expiry_date)) },
                    )
                }
                Button(onClick = viewModel::confirmQuantity, enabled = !ui.pending, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.save))
                }
            }
        }
    }
    if (ui.detailsOpen) {
        ModalBottomSheet(
            onDismissRequest = viewModel::closeSheets,
            sheetState = detailsSheetState,
            sheetGesturesEnabled = true,
        ) {
            Column(
                Modifier
                    .imePadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.edit_batch), style = MaterialTheme.typography.titleMedium)
                if (product?.tracksPacks == true) {
                    OutlinedTextField(
                        ui.batchNumber,
                        viewModel::setBatchNumber,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.batch_number)) },
                    )
                }
                OutlinedTextField(
                    ui.expiresOn,
                    viewModel::setExpiresOn,
                    Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.expiry_date)) },
                )
                Button(onClick = viewModel::confirmDetails, enabled = !ui.pending, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.save))
                }
            }
        }
    }
}

private fun productDetailRows(product: com.tabaaq.mobile.core.catalog.CatalogProduct): List<Pair<String, String>> =
    buildList {
        add("Category" to product.category)
        product.composition?.let { add("Composition" to it) }
        product.strength?.let { add("Strength" to it) }
        product.aisle?.let { add("Aisle" to "Aisle $it") }
        if (product.tracksPacks) add("Units per pack" to product.unitsPerPack.toString())
        add("Purchase price" to MoneyFormat.formatPaisa(product.purchasePrice))
        if (product.tracksPacks) add("Retail price" to MoneyFormat.formatPaisa(product.retailPrice))
        add((if (product.tracksPacks) "Unit price" else "Retail price") to MoneyFormat.formatPaisa(product.unitPrice))
    }

private fun batchStockLabel(
    batch: CatalogBatch,
    tracksPacks: Boolean,
): String {
    if (!tracksPacks) return "${batch.unitQuantity} units"
    val packs = "${batch.packQuantity} ${if (batch.packQuantity == 1L) "pack" else "packs"}"
    return if (batch.unitQuantity > 0) "$packs · ${batch.unitQuantity} loose" else packs
}

private fun batchExpiryLabel(batch: CatalogBatch): String {
    val value = ScanNormalize.expiryInputValue(batch.expiresAt)
    return if (value.isBlank()) "No expiry" else "Exp $value"
}
