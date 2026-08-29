package com.tabaaq.android.ui.home

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.android.R
import com.tabaaq.android.core.catalog.MoneyFormat
import com.tabaaq.android.ui.catalog.CatalogViewModel

@Composable
fun HomeScreen(
    viewModel: CatalogViewModel,
    contentPadding: PaddingValues,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Inventory", style = MaterialTheme.typography.headlineSmall)
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
                OverviewCard(ui.overview.count, ui.overview.lowStock, ui.overview.outOfStock, ui.overview.stockValue)
            }
        }
        item {
            Text(
                stringResource(R.string.needs_attention),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        if (ui.attention.isEmpty() && ui.sync.hasSynced == true) {
            item {
                Text(
                    "Nothing needs restocking right now.",
                    modifier = Modifier.padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(ui.attention, key = { it.id }) { product ->
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                ListItem(
                    headlineContent = { Text(product.name) },
                    supportingContent = { Text(product.category) },
                    trailingContent = { Text(product.stockLabel) },
                )
            }
        }
    }
}

@Composable
private fun OverviewCard(
    count: Int,
    low: Int,
    out: Int,
    value: Long,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$count products", style = MaterialTheme.typography.titleMedium)
            Text("$low low · $out out of stock", style = MaterialTheme.typography.bodyMedium)
            Text("Stock value ${MoneyFormat.formatPaisa(value)}", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
