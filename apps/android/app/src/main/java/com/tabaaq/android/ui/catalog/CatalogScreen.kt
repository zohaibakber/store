package com.tabaaq.android.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.android.R
import com.tabaaq.android.core.catalog.CatalogProduct
import com.tabaaq.android.core.catalog.MoneyFormat
import com.tabaaq.android.core.catalog.StockFilter

@Composable
fun CatalogScreen(
    viewModel: CatalogViewModel,
    contentPadding: PaddingValues,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val narrowed = ui.query.isNotBlank() || ui.filter != StockFilter.All

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = ui.query,
                    onValueChange = viewModel::setQuery,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text(stringResource(R.string.search_products)) },
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(StockFilter.entries.toList()) { option ->
                        FilterChip(
                            selected = ui.filter == option,
                            onClick = { viewModel.setFilter(option) },
                            label = { Text(filterLabel(option)) },
                        )
                    }
                }
                StatusBanner(ui)
                Text(
                    "${ui.filtered.size} ${if (ui.filtered.size == 1) "product" else "products"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (ui.sync.downloading || ui.sync.hasSynced != true && ui.products.isEmpty()) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) }
        }
        if (ui.filtered.isEmpty()) {
            item {
                EmptyCatalog(narrowed = narrowed, syncing = ui.sync.hasSynced != true && !ui.offline)
            }
        } else {
            items(ui.filtered, key = { it.id }) { product ->
                ProductCard(product)
            }
        }
    }
}

@Composable
private fun StatusBanner(ui: CatalogUiState) {
    when {
        ui.organizationMissing -> Text(stringResource(R.string.no_organization), color = MaterialTheme.colorScheme.error)
        ui.workspaceError != null -> Text(requireNotNull(ui.workspaceError), color = MaterialTheme.colorScheme.error)
        ui.offline -> {
            Text(stringResource(R.string.offline_title), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.offline_body), style = MaterialTheme.typography.bodySmall)
        }
        ui.sync.error != null -> Text(requireNotNull(ui.sync.error), color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun EmptyCatalog(
    narrowed: Boolean,
    syncing: Boolean,
) {
    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (syncing) {
            Text(stringResource(R.string.syncing), style = MaterialTheme.typography.bodyMedium)
        } else {
            Text(
                stringResource(if (narrowed) R.string.empty_search_title else R.string.empty_catalog_title),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                stringResource(if (narrowed) R.string.empty_search_body else R.string.empty_catalog_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ProductCard(product: CatalogProduct) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        ListItem(
            headlineContent = { Text(product.name) },
            supportingContent = {
                val bits = listOfNotNull(product.category, product.details.takeIf { it.isNotBlank() }, product.aisle?.let { "Aisle $it" })
                Text(bits.joinToString(" · "))
            },
            trailingContent = {
                Column {
                    Text(product.stockLabel, style = MaterialTheme.typography.labelLarge)
                    Text(MoneyFormat.formatPaisa(product.unitPrice), style = MaterialTheme.typography.bodySmall)
                }
            },
        )
    }
}

@Composable
private fun filterLabel(filter: StockFilter): String =
    when (filter) {
        StockFilter.All -> stringResource(R.string.filter_all)
        StockFilter.Low -> stringResource(R.string.filter_low)
        StockFilter.Out -> stringResource(R.string.filter_out)
        StockFilter.Hidden -> stringResource(R.string.filter_hidden)
    }
