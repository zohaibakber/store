package com.tabaaq.mobile.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.tabaaq.mobile.R
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@Composable
fun InventoryFabs(
    onScan: () -> Unit,
    onAdd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(end = 8.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.End,
    ) {
        SmallFloatingActionButton(onClick = onScan) {
            Icon(Icons.Outlined.DocumentScanner, contentDescription = stringResource(R.string.scan_label))
        }
        FloatingActionButton(onClick = onAdd) {
            Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.new_product))
        }
    }
}

@Composable
fun ScreenTitle(text: String) {
    Text(text, style = EmphasizedTypography.headlineSmall)
}
