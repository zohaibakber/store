package com.tabaaq.mobile.ui.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
    Scaffold(
        bottomBar = {
            Surface {
                Button(
                    onClick = viewModel::save,
                    enabled = !ui.saving,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(
                        if (ui.saving) {
                            stringResource(R.string.saving_product)
                        } else {
                            stringResource(R.string.create_product)
                        },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                )
            }
            Text(
                stringResource(R.string.product_editor_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            ui.error?.let {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(it, modifier = Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium)
                }
            }
            EditorSection(
                title = stringResource(R.string.product_section),
                icon = Icons.Outlined.Inventory2,
            ) {
                OutlinedTextField(
                    value = ui.name,
                    onValueChange = viewModel::setName,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.product_name)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = ui.composition,
                    onValueChange = viewModel::setComposition,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.composition_label)) },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = ui.strength,
                        onValueChange = viewModel::setStrength,
                        modifier = Modifier.weight(1f),
                        label = { Text(stringResource(R.string.strength_label)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                    )
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProductEditorViewModel.strengthUnits.forEach { unit ->
                        FilterChip(
                            selected = ui.strengthUnit == unit,
                            onClick = { viewModel.setStrengthUnit(unit) },
                            label = { Text(unit) },
                        )
                    }
                }
                OutlinedTextField(
                    value = ui.aisle,
                    onValueChange = viewModel::setAisle,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.aisle_label)) },
                    singleLine = true,
                )
            }
            EditorSection(
                title = stringResource(R.string.category_label),
                icon = Icons.Outlined.Category,
            ) {
                if (ui.categories.isEmpty()) {
                    Text(
                        stringResource(R.string.general_category_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    CategoryDropdown(
                        categories = ui.categories.map { it.id to it.name },
                        selectedId = ui.categoryId,
                        onSelect = viewModel::setCategoryId,
                    )
                    Text(
                        stringResource(if (ui.tracksPacks) R.string.sold_in_packs_hint else R.string.sold_as_units_hint),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            EditorSection(
                title = stringResource(if (ui.tracksPacks) R.string.pack_pricing else R.string.unit_pricing),
                icon = Icons.Outlined.Payments,
            ) {
                if (ui.tracksPacks) {
                    OutlinedTextField(
                        value = ui.unitsPerPack,
                        onValueChange = viewModel::setUnitsPerPack,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.units_per_pack)) },
                        placeholder = { Text("1") },
                        supportingText = { Text(stringResource(R.string.units_per_pack_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = ui.packPrice,
                        onValueChange = viewModel::setPackPrice,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.pack_price)) },
                        supportingText = { Text(stringResource(R.string.price_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = ui.unitPrice,
                        onValueChange = viewModel::setUnitPrice,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.unit_price)) },
                        supportingText = { Text(stringResource(R.string.unit_price_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                } else {
                    OutlinedTextField(
                        value = ui.unitPrice,
                        onValueChange = viewModel::setUnitPrice,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.price_label)) },
                        supportingText = { Text(stringResource(R.string.price_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategoryDropdown(
    categories: List<Pair<String, String>>,
    selectedId: String,
    onSelect: (String) -> Unit,
) {
    var menuRequested by remember { mutableStateOf(false) }
    val selectedName = categories.firstOrNull { it.first == selectedId }?.second.orEmpty()
    val textFieldState = rememberTextFieldState(selectedName)
    val filteredCategories =
        categories.filter { (_, name) ->
            textFieldState.text.isBlank() || name.contains(textFieldState.text, ignoreCase = true)
        }
    val expanded = menuRequested && filteredCategories.isNotEmpty()

    LaunchedEffect(selectedName) {
        if (!menuRequested && textFieldState.text.toString() != selectedName) {
            textFieldState.setTextAndPlaceCursorAtEnd(selectedName)
        }
    }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { requested ->
            menuRequested = requested
            if (requested && textFieldState.text.toString() == selectedName) {
                textFieldState.setTextAndPlaceCursorAtEnd("")
            }
        },
    ) {
        OutlinedTextField(
            state = textFieldState,
            modifier =
                Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable)
                    .fillMaxWidth(),
            lineLimits = TextFieldLineLimits.SingleLine,
            shape = MaterialTheme.shapes.large,
            label = { Text(stringResource(R.string.category_label)) },
            placeholder = { Text(stringResource(R.string.search_categories)) },
            leadingIcon = { Icon(Icons.Outlined.Category, contentDescription = null) },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(
                    expanded = expanded,
                    modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.SecondaryEditable),
                )
            },
        )
        ExposedDropdownMenu(
            modifier = Modifier.heightIn(max = 280.dp),
            expanded = expanded,
            onDismissRequest = {
                menuRequested = false
                textFieldState.setTextAndPlaceCursorAtEnd(selectedName)
            },
        ) {
            filteredCategories.forEach { (id, name) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = {
                        textFieldState.setTextAndPlaceCursorAtEnd(name)
                        onSelect(id)
                        menuRequested = false
                    },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
        }
    }
}

@Composable
private fun EditorSection(
    title: String,
    icon: ImageVector,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Icon(icon, contentDescription = null, modifier = Modifier.padding(8.dp).size(20.dp))
                }
                Spacer(Modifier.width(10.dp))
                Text(title, style = EmphasizedTypography.titleMedium)
            }
            content()
        }
    }
}
