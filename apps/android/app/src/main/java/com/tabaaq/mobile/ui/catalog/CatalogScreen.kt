package com.tabaaq.mobile.ui.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.catalog.CatalogProduct
import com.tabaaq.mobile.core.catalog.StockFilter
import com.tabaaq.mobile.ui.components.ListInset
import com.tabaaq.mobile.ui.components.ListItemGap
import com.tabaaq.mobile.ui.components.ListLeadIcon
import com.tabaaq.mobile.ui.components.listSheetRowColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    viewModel: CatalogViewModel,
    contentPadding: PaddingValues,
    onOpenProduct: (String) -> Unit,
    onScan: () -> Unit,
    onAdd: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val narrowed = ui.query.isNotBlank() || ui.filter != StockFilter.All
    val pullToRefreshState = rememberPullToRefreshState()
    val navBarPadding = contentPadding.calculateBottomPadding()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            InventorySearchTopBar(
                query = ui.query,
                onQueryChange = viewModel::setQuery,
                onAdd = onAdd,
                windowInsets = WindowInsets(top = contentPadding.calculateTopPadding()),
            )
        },
        floatingActionButton = {
            ScanFab(
                onScan = onScan,
                modifier = Modifier.padding(bottom = navBarPadding),
            )
        },
    ) { innerPadding ->
        PullToRefreshBox(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(
                        top = innerPadding.calculateTopPadding(),
                        bottom = innerPadding.calculateBottomPadding() + navBarPadding,
                    ),
            isRefreshing = refreshing,
            onRefresh = viewModel::refresh,
            state = pullToRefreshState,
            indicator = {
                PullToRefreshDefaults.Indicator(
                    modifier = Modifier.align(Alignment.TopCenter),
                    isRefreshing = refreshing,
                    state = pullToRefreshState,
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            },
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(ListItemGap),
            ) {
                item {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(StockFilter.entries.toList()) { option ->
                            FilterChip(
                                selected = ui.filter == option,
                                onClick = { viewModel.setFilter(option) },
                                label = { Text(filterLabel(option)) },
                            )
                        }
                    }
                }
                item {
                    Column(
                        Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        StatusBanner(ui)
                        Text(
                            stringResource(R.string.product_result_count, ui.filtered.size),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (ui.sync.downloading || ui.sync.hasSynced != true && ui.products.isEmpty()) {
                    item {
                        LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                    }
                }
                if (ui.filtered.isEmpty()) {
                    item {
                        EmptyCatalog(
                            narrowed = narrowed,
                            syncing = ui.sync.hasSynced != true && !ui.offline,
                        )
                    }
                } else {
                    items(ui.filtered, key = { it.id }) { product ->
                        ProductRow(product, onClick = { onOpenProduct(product.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusBanner(ui: CatalogUiState) {
    val message =
        when {
            ui.organizationMissing -> stringResource(R.string.no_organization)
            ui.workspaceError != null -> requireNotNull(ui.workspaceError)
            ui.offline -> stringResource(R.string.offline_body)
            ui.sync.error != null -> requireNotNull(ui.sync.error)
            else -> null
        }
    if (message != null) {
        Surface(
            color =
                if (ui.organizationMissing || ui.workspaceError != null || ui.sync.error != null) {
                    MaterialTheme.colorScheme.errorContainer
                } else {
                    MaterialTheme.colorScheme.secondaryContainer
                },
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(message, modifier = Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun EmptyCatalog(
    narrowed: Boolean,
    syncing: Boolean,
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.secondaryContainer,
            shape = MaterialTheme.shapes.extraLarge,
        ) {
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Inventory2, contentDescription = null, modifier = Modifier.size(30.dp))
            }
        }
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
private fun ProductRow(
    product: CatalogProduct,
    onClick: () -> Unit,
) {
    val needsAttention = product.stock <= 10L
    ListItem(
        modifier =
            Modifier
                .padding(horizontal = ListInset)
                .clip(MaterialTheme.shapes.extraLarge)
                .clickable(onClick = onClick),
        colors = listSheetRowColors(),
        headlineContent = {
            Text(product.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        leadingContent = {
            ListLeadIcon(if (needsAttention) Icons.Outlined.WarningAmber else Icons.Outlined.Inventory2)
        },
        trailingContent = {
            Text(
                product.stockLabel,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        },
    )
}

@Composable
private fun filterLabel(filter: StockFilter): String =
    when (filter) {
        StockFilter.All -> stringResource(R.string.filter_all)
        StockFilter.Low -> stringResource(R.string.filter_low)
        StockFilter.Out -> stringResource(R.string.filter_out)
        StockFilter.Hidden -> stringResource(R.string.filter_hidden)
    }
