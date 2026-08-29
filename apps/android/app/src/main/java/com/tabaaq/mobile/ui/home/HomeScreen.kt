package com.tabaaq.mobile.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.catalog.CatalogFilter
import com.tabaaq.mobile.core.catalog.CatalogProduct
import com.tabaaq.mobile.core.catalog.MoneyFormat
import com.tabaaq.mobile.ui.catalog.CatalogViewModel
import com.tabaaq.mobile.ui.catalog.ScanFab
import com.tabaaq.mobile.ui.components.ListInset
import com.tabaaq.mobile.ui.components.ListLeadIcon
import com.tabaaq.mobile.ui.components.ListSheet
import com.tabaaq.mobile.ui.components.listSheetRowColors
import com.tabaaq.mobile.ui.theme.AppMotion
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@Composable
fun HomeScreen(
    viewModel: CatalogViewModel,
    contentPadding: PaddingValues,
    onOpenProduct: (String) -> Unit,
    onOpenProducts: () -> Unit,
    onScan: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    var valueShown by remember { mutableStateOf(false) }
    val navBarPadding = contentPadding.calculateBottomPadding()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        floatingActionButton = {
            ScanFab(
                onScan = onScan,
                modifier = Modifier.padding(bottom = navBarPadding),
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding =
                PaddingValues(
                    top = contentPadding.calculateTopPadding() + 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + navBarPadding + 16.dp,
                ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (ui.sync.downloading || ui.sync.hasSynced != true && ui.products.isEmpty()) {
                item {
                    Column(
                        Modifier.padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(stringResource(R.string.syncing), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item {
                InventoryHero(
                    productCount = ui.overview.count,
                    stockValue = MoneyFormat.formatPaisa(ui.overview.stockValue),
                    valueShown = valueShown,
                    onToggleValue = { valueShown = !valueShown },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            item {
                Row(
                    Modifier.padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    MetricCard(
                        label = stringResource(R.string.filter_low),
                        value = ui.overview.lowStock.toString(),
                        supporting = stringResource(R.string.low_stock_hint, CatalogFilter.LOW_STOCK_THRESHOLD),
                        warning = ui.overview.lowStock > 0,
                        modifier = Modifier.weight(1f),
                    )
                    MetricCard(
                        label = stringResource(R.string.filter_out),
                        value = ui.overview.outOfStock.toString(),
                        supporting = stringResource(R.string.stock_attention),
                        warning = ui.overview.outOfStock > 0,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            if (ui.workspaceError != null || ui.offline) {
                item {
                    Surface(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Text(
                            ui.workspaceError ?: stringResource(R.string.offline_body),
                            modifier = Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            item {
                Row(
                    Modifier.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(R.string.needs_attention),
                        modifier = Modifier.weight(1f),
                        style = EmphasizedTypography.titleMedium,
                    )
                    Surface(onClick = onOpenProducts, shape = MaterialTheme.shapes.small) {
                        Row(
                            modifier = Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(stringResource(R.string.all_products), style = MaterialTheme.typography.labelLarge)
                            Icon(Icons.Outlined.ChevronRight, contentDescription = null)
                        }
                    }
                }
            }
            if (ui.attention.isEmpty()) {
                item {
                    Surface(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Text(
                            if (ui.products.isEmpty()) {
                                stringResource(R.string.empty_catalog_body)
                            } else {
                                stringResource(R.string.stock_healthy)
                            },
                            modifier = Modifier.padding(20.dp),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                }
            } else {
                item {
                    ListSheet(Modifier.padding(horizontal = ListInset)) {
                        ui.attention.forEach { product ->
                            AttentionProductRow(product, onClick = { onOpenProduct(product.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InventoryHero(
    productCount: Int,
    stockValue: String,
    valueShown: Boolean,
    onToggleValue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shape = MaterialTheme.shapes.extraLarge,
        tonalElevation = 2.dp,
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
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
                Column {
                    Text(stringResource(R.string.total_products), style = MaterialTheme.typography.bodyMedium)
                    AnimatedMetric(productCount.toString(), style = MaterialTheme.typography.headlineMedium)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.stock_value), style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.height(2.dp))
                    AnimatedMetric(
                        value = if (valueShown) stockValue else "••••••",
                        style = EmphasizedTypography.titleLarge,
                    )
                    if (!valueShown) {
                        Text(
                            stringResource(R.string.tap_stock_value),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                IconButton(onClick = onToggleValue) {
                    Icon(
                        if (valueShown) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        contentDescription = stringResource(R.string.stock_value),
                    )
                }
            }
        }
    }
}

@Composable
private fun MetricCard(
    label: String,
    value: String,
    supporting: String,
    warning: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors =
        if (warning) {
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        } else {
            CardDefaults.cardColors()
        }
    Card(modifier = modifier, colors = colors) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (warning) {
                    Icon(Icons.Outlined.WarningAmber, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                }
                Text(label, style = MaterialTheme.typography.labelLarge)
            }
            AnimatedMetric(value, style = MaterialTheme.typography.headlineMedium)
            Text(supporting, style = MaterialTheme.typography.bodySmall, maxLines = 2)
        }
    }
}

@Composable
private fun AnimatedMetric(
    value: String,
    style: androidx.compose.ui.text.TextStyle,
) {
    AnimatedContent(
        targetState = value,
        transitionSpec = {
            (fadeIn(AppMotion.fastEffects()) + scaleIn(AppMotion.fastSpatial(), initialScale = 0.9f)) togetherWith
                (fadeOut(AppMotion.fastEffects()) + scaleOut(AppMotion.fastSpatial(), targetScale = 1.06f))
        },
        label = "Inventory metric",
    ) { current ->
        Text(current, style = style)
    }
}

@Composable
private fun AttentionProductRow(
    product: CatalogProduct,
    onClick: () -> Unit,
) {
    ListItem(
        modifier =
            Modifier
                .clip(MaterialTheme.shapes.extraLarge)
                .clickable(onClick = onClick),
        colors = listSheetRowColors(),
        headlineContent = {
            Text(product.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        leadingContent = { ListLeadIcon(Icons.Outlined.WarningAmber) },
        trailingContent = {
            Text(
                product.stockLabel,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        },
    )
}
