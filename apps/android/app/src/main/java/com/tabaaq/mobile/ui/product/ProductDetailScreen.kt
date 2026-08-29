package com.tabaaq.mobile.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.catalog.CatalogBatch
import com.tabaaq.mobile.core.catalog.CatalogFilter
import com.tabaaq.mobile.core.catalog.MoneyFormat
import com.tabaaq.mobile.core.scan.ScanNormalize
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(
    viewModel: ProductDetailViewModel,
    onBack: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val product = ui.product
    val quantitySheetState = rememberModalBottomSheetState()
    val detailsSheetState = rememberModalBottomSheetState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(product?.name ?: stringResource(R.string.product_section), style = EmphasizedTypography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                expandedHeight = TopAppBarDefaults.TopAppBarExpandedHeight,
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
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(product.name, style = EmphasizedTypography.headlineSmall)
                    if (product.details.isNotBlank()) {
                        Text(product.details, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val tone =
                        when {
                            product.stock == 0L -> MaterialTheme.colorScheme.error
                            product.stock <= CatalogFilter.LOW_STOCK_THRESHOLD -> MaterialTheme.colorScheme.tertiary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    Text(product.stockLabel, color = tone, style = MaterialTheme.typography.titleMedium)
                    if (!product.visible) Text(stringResource(R.string.filter_hidden), style = MaterialTheme.typography.labelLarge)
                }
            }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            ui.notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            Card(Modifier.fillMaxWidth()) {
                productDetailRows(product).forEach { (label, value) ->
                    ListItem(headlineContent = { Text(label) }, trailingContent = { Text(value) })
                }
            }
            Text(stringResource(R.string.batches_section), style = MaterialTheme.typography.titleMedium)
            if (product.batches.isEmpty()) {
                Text(stringResource(R.string.no_batches), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            product.batches.forEach { batch ->
                Card(Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(batch.batchNumber ?: stringResource(R.string.unnamed_batch)) },
                        supportingContent = {
                            Text(listOf(batchStockLabel(batch, product.tracksPacks), batchExpiryLabel(batch)).joinToString(" · "))
                        },
                    )
                    TextButton(onClick = { viewModel.openQuantity(batch.id) }) { Text(stringResource(R.string.edit_quantity)) }
                    TextButton(onClick = { viewModel.openDetails(batch.id) }) { Text(stringResource(R.string.edit_batch)) }
                }
            }
            FilledTonalButton(onClick = { viewModel.openDetails(null) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.add_batch))
            }
            Button(onClick = { viewModel.openQuantity(null) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.add_stock))
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
                Text(stringResource(R.string.edit_quantity), style = MaterialTheme.typography.titleMedium)
                if (product?.tracksPacks == true) {
                    OutlinedTextField(
                        ui.packQuantity,
                        viewModel::setPackQuantity,
                        Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.pack_quantity)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
                OutlinedTextField(
                    ui.unitQuantity,
                    viewModel::setUnitQuantity,
                    Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.unit_quantity)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
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
                OutlinedTextField(ui.batchNumber, viewModel::setBatchNumber, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.batch_number)) })
                OutlinedTextField(ui.expiresOn, viewModel::setExpiresOn, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.expiry_date)) })
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
        if (product.tracksPacks) add("Pack price" to MoneyFormat.formatPaisa(product.packPrice))
        add((if (product.tracksPacks) "Unit price" else "Price") to MoneyFormat.formatPaisa(product.unitPrice))
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
