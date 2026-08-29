package com.tabaaq.mobile.ui.settings

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import android.text.format.DateUtils
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.BuildConfig
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.auth.authenticatedUser
import com.tabaaq.mobile.data.auth.AuthState
import com.tabaaq.mobile.di.AppContainer
import com.tabaaq.mobile.ui.catalog.CatalogUiState
import com.tabaaq.mobile.ui.catalog.CatalogViewModel
import com.tabaaq.mobile.ui.components.ListInset
import com.tabaaq.mobile.ui.components.ListLeadIcon
import com.tabaaq.mobile.ui.components.ListSheet
import com.tabaaq.mobile.ui.components.listSheetRowColors
import com.tabaaq.mobile.ui.components.listSheetShape

@Composable
fun SettingsScreen(
    container: AppContainer,
    catalog: CatalogViewModel,
    contentPadding: PaddingValues,
    onSignOut: () -> Unit,
) {
    val auth by container.authRepository.state.collectAsStateWithLifecycle()
    val catalogUi by catalog.ui.collectAsStateWithLifecycle()
    var confirmSignOut by remember { mutableStateOf(false) }
    val signed = auth as? AuthState.SignedIn
    val user = signed?.workspace?.authenticatedUser()
    val organization = signed?.workspace?.activeOrganization ?: signed?.workspace?.organizations?.firstOrNull()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding =
            PaddingValues(
                top = contentPadding.calculateTopPadding() + 8.dp,
                bottom = contentPadding.calculateBottomPadding() + 24.dp,
            ),
    ) {
        item {
            ListSheet(Modifier.padding(horizontal = ListInset, vertical = 8.dp)) {
                ListItem(
                    modifier = Modifier.clip(MaterialTheme.shapes.extraLarge),
                    colors = listSheetRowColors(),
                    headlineContent = {
                        Text(
                            user?.name ?: stringResource(R.string.signed_out),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingContent = { ListLeadIcon(Icons.Outlined.Person) },
                    trailingContent = {
                        Text(
                            user?.email ?: stringResource(R.string.not_available),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                )
            }
        }
        item { SettingsSection(stringResource(R.string.store_section)) }
        item {
            ListSheet(Modifier.padding(horizontal = ListInset)) {
                SettingsValue(
                    label = stringResource(R.string.store_name),
                    value = organization?.name ?: stringResource(R.string.not_available),
                    icon = Icons.Outlined.Store,
                    shape = listSheetShape(0, 2),
                )
                SettingsValue(
                    label = stringResource(R.string.access_level),
                    value = organization?.let { roleLabel(it.role) } ?: stringResource(R.string.not_available),
                    icon = Icons.Outlined.Badge,
                    shape = listSheetShape(1, 2),
                )
            }
        }
        item { SettingsSection(stringResource(R.string.sync_offline_settings)) }
        item {
            ListSheet(Modifier.padding(horizontal = ListInset)) {
                SettingsValue(
                    label = syncStatus(catalogUi),
                    icon = Icons.Outlined.Sync,
                    shape = listSheetShape(0, 4),
                )
                SettingsValue(
                    label = stringResource(R.string.products_ready_offline),
                    value = catalogUi.overview.count.toString(),
                    icon = Icons.Outlined.Inventory2,
                    shape = listSheetShape(1, 4),
                )
                SettingsValue(
                    label = stringResource(R.string.last_refreshed),
                    value = lastRefreshedValue(catalogUi.sync.lastSyncedAtMillis),
                    icon = Icons.Outlined.CloudDone,
                    shape = listSheetShape(2, 4),
                )
                SettingsValue(
                    label = stringResource(R.string.offline_access),
                    value = stringResource(R.string.available),
                    icon = Icons.Outlined.Cloud,
                    shape = listSheetShape(3, 4),
                )
            }
        }
        catalogUi.sync.error?.let { error ->
            item {
                Text(
                    error,
                    modifier = Modifier.padding(horizontal = 32.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        item { SettingsSection(stringResource(R.string.about_tabaaq)) }
        item {
            ListSheet(Modifier.padding(horizontal = ListInset)) {
                SettingsValue(
                    label = stringResource(R.string.app_name),
                    value = stringResource(R.string.version_summary, BuildConfig.VERSION_NAME),
                    icon = Icons.Outlined.Info,
                    shape = MaterialTheme.shapes.extraLarge,
                )
            }
        }
        if (signed != null) {
            item {
                TextButton(
                    onClick = { confirmSignOut = true },
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
                    Text(
                        stringResource(R.string.sign_out),
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
        }
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            icon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null) },
            title = { Text(stringResource(R.string.sign_out)) },
            text = { Text(stringResource(R.string.sign_out_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmSignOut = false
                        onSignOut()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.sign_out)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun SettingsSection(text: String) {
    Text(
        text,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.titleSmall,
    )
}

@Composable
private fun SettingsValue(
    label: String,
    icon: ImageVector,
    shape: Shape,
    value: String? = null,
) {
    ListItem(
        modifier = Modifier.clip(shape),
        colors = listSheetRowColors(),
        headlineContent = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingContent = { ListLeadIcon(icon) },
        trailingContent =
            value?.let {
                {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            },
    )
}

@Composable
private fun lastRefreshedValue(millis: Long?): String {
    if (millis == null) return stringResource(R.string.never)
    val context = LocalContext.current
    val flags =
        DateUtils.FORMAT_SHOW_TIME or
            if (DateUtils.isToday(millis)) {
                0
            } else {
                DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH or DateUtils.FORMAT_NO_YEAR
            }
    return DateUtils.formatDateTime(context, millis, flags)
}

@Composable
private fun syncStatus(ui: CatalogUiState): String =
    stringResource(
        when {
            ui.sync.connected -> R.string.sync_live
            ui.offline -> R.string.sync_offline
            ui.sync.connecting -> R.string.sync_connecting
            else -> R.string.sync_disconnected
        },
    )

private fun roleLabel(role: String): String = role.replaceFirstChar { it.titlecase() }
