package com.tabaaq.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.android.BuildConfig
import com.tabaaq.android.R
import com.tabaaq.android.core.auth.authenticatedUser
import com.tabaaq.android.data.auth.AuthState
import com.tabaaq.android.di.AppContainer
import com.tabaaq.android.ui.catalog.CatalogViewModel

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

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(contentPadding)
                .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.account_section), style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            ListItem(
                headlineContent = { Text(user?.name ?: stringResource(R.string.signed_out)) },
                supportingContent = { Text(user?.email.orEmpty()) },
            )
            if (organization != null) {
                ListItem(
                    headlineContent = { Text(organization.name) },
                    supportingContent = { Text(organization.role) },
                )
            }
        }
        if (signed != null) {
            Button(onClick = { confirmSignOut = true }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.sign_out))
            }
        }

        Text(stringResource(R.string.inventory_section), style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            ListItem(
                headlineContent = { Text("${catalogUi.overview.count} products") },
                supportingContent = {
                    val synced = catalogUi.sync.hasSynced
                    val connection =
                        when {
                            catalogUi.sync.connected -> "Live"
                            catalogUi.offline -> "Offline replica"
                            catalogUi.sync.connecting -> "Connecting"
                            else -> "Disconnected"
                        }
                    Text("$connection · first sync ${if (synced == true) "done" else "pending"}")
                },
            )
            if (container.config.powerSyncUrlFallback.isNotBlank()) {
                ListItem(
                    headlineContent = { Text("PowerSync fallback") },
                    supportingContent = { Text(container.config.powerSyncUrlFallback) },
                )
            }
        }

        Text("About", style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            ListItem(
                headlineContent = { Text("Tabaaq Android ${BuildConfig.VERSION_NAME}") },
                supportingContent = {
                    Text("Native Compose client. Expo remains in apps/mobile for scan, invoices, and catalog edits.")
                },
            )
            ListItem(
                headlineContent = { Text("Auth") },
                supportingContent = {
                    val firebase = if (container.firebaseAuth.available) "Firebase Auth is initialized beside it." else "Firebase Auth is waiting for google-services.json."
                    Text("First-party JWT + Google ID token, same as Expo. $firebase")
                },
            )
        }
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text(stringResource(R.string.sign_out)) },
            text = { Text(stringResource(R.string.sign_out_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmSignOut = false
                        onSignOut()
                    },
                ) { Text(stringResource(R.string.sign_out)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}
