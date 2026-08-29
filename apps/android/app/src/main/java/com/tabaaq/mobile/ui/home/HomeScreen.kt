package com.tabaaq.mobile.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.catalog.CatalogFilter
import com.tabaaq.mobile.core.catalog.MoneyFormat
import com.tabaaq.mobile.ui.catalog.CatalogViewModel
import com.tabaaq.mobile.ui.catalog.InventoryFabs
import com.tabaaq.mobile.ui.catalog.ScreenTitle
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@Composable
fun HomeScreen(
    viewModel: CatalogViewModel,
    contentPadding: PaddingValues,
    onOpenProduct: (String) -> Unit,
    onOpenProducts: () -> Unit,
    onScan: () -> Unit,
    onAdd: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    var valueShown by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ScreenTitle(stringResource(R.string.inventory_section))
                    if (ui.sync.downloading || ui.sync.hasSynced != true && ui.products.isEmpty()) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(stringResource(R.string.syncing), style = MaterialTheme.typography.bodySmall)
                    }
                    ui.workspaceError?.let { message ->
                        Text(message, color = MaterialTheme.colorScheme.error)
                    }
                    if (ui.offline) {
                        Text(stringResource(R.string.offline_body), style = MaterialTheme.typography.bodyMedium)
                    }
                    Card(Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = { Text(stringResource(R.string.products_count)) },
                            trailingContent = { Text("${ui.overview.count}", style = EmphasizedTypography.titleMedium) },
                        )
                        ListItem(
                            headlineContent = { Text(stringResource(R.string.filter_low)) },
                            supportingContent = { Text(stringResource(R.string.low_stock_hint, CatalogFilter.LOW_STOCK_THRESHOLD)) },
                            trailingContent = { Text("${ui.overview.lowStock}") },
                        )
                        ListItem(
                            headlineContent = { Text(stringResource(R.string.filter_out)) },
                            trailingContent = { Text("${ui.overview.outOfStock}") },
                        )
                        ListItem(
                            headlineContent = { Text(stringResource(R.string.stock_value)) },
                            trailingContent = {
                                Text(if (valueShown) MoneyFormat.formatPaisa(ui.overview.stockValue) else "••••••")
                            },
                            modifier = Modifier.clickable { valueShown = !valueShown },
                        )
                    }
                }
            }
            item {
                Text(
                    stringResource(R.string.needs_attention),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            if (ui.attention.isEmpty()) {
                item {
                    Text(
                        if (ui.products.isEmpty()) stringResource(R.string.empty_catalog_body) else stringResource(R.string.stock_healthy),
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(ui.attention, key = { it.id }) { product ->
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .clickable { onOpenProduct(product.id) },
                ) {
                    ListItem(
                        headlineContent = { Text(product.name) },
                        supportingContent = { Text(product.category) },
                        trailingContent = { Text(product.stockLabel) },
                    )
                }
            }
            item {
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .clickable(onClick = onOpenProducts),
                ) {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.all_products)) },
                        trailingContent = { Text("${ui.products.size}") },
                    )
                }
            }
        }
        InventoryFabs(onScan = onScan, onAdd = onAdd, modifier = Modifier.align(Alignment.BottomEnd).padding(contentPadding))
    }
}
