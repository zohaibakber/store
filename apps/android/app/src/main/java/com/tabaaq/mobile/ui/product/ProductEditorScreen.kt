package com.tabaaq.mobile.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProductEditorScreen(
    viewModel: ProductEditorViewModel,
    onBack: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(ui.createdId) {
        val id = ui.createdId ?: return@LaunchedEffect
        onCreated(id)
    }
    val tracksPacks = ui.categories.find { it.id == ui.categoryId }?.tracksPacks ?: true

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.new_product), style = EmphasizedTypography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Text(stringResource(R.string.product_section), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(ui.name, viewModel::setName, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.product_name)) }, singleLine = true)
            Text(stringResource(R.string.category_label), style = MaterialTheme.typography.labelLarge)
            if (ui.categories.isEmpty()) {
                Text(stringResource(R.string.general_category_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ui.categories.forEach { category ->
                        FilterChip(
                            selected = category.id == ui.categoryId,
                            onClick = { viewModel.setCategoryId(category.id) },
                            label = { Text(category.name) },
                        )
                    }
                }
            }
            OutlinedTextField(ui.composition, viewModel::setComposition, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.composition_label)) }, singleLine = true)
            OutlinedTextField(ui.strength, viewModel::setStrength, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.strength_label)) }, singleLine = true)
            OutlinedTextField(ui.aisle, viewModel::setAisle, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.aisle_label)) }, singleLine = true)
            Text(stringResource(R.string.pack_pricing), style = MaterialTheme.typography.titleMedium)
            if (tracksPacks) {
                OutlinedTextField(
                    ui.unitsPerPack,
                    viewModel::setUnitsPerPack,
                    Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.units_per_pack)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
                OutlinedTextField(
                    ui.packPrice,
                    viewModel::setPackPrice,
                    Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.pack_price)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                )
            }
            OutlinedTextField(
                ui.unitPrice,
                viewModel::setUnitPrice,
                Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.unit_price)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                supportingText = { Text(stringResource(R.string.price_hint)) },
            )
            Button(onClick = viewModel::save, enabled = !ui.saving, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.create_product))
            }
        }
    }
}
