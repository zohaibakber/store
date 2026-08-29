package com.tabaaq.mobile.ui.navigation

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.ui.NavDisplay
import com.tabaaq.mobile.R
import com.tabaaq.mobile.data.auth.AuthState
import com.tabaaq.mobile.di.AppContainer
import com.tabaaq.mobile.ui.catalog.CatalogScreen
import com.tabaaq.mobile.ui.catalog.CatalogViewModel
import com.tabaaq.mobile.ui.home.HomeScreen
import com.tabaaq.mobile.ui.session.SessionViewModel
import com.tabaaq.mobile.ui.settings.SettingsScreen
import com.tabaaq.mobile.ui.settings.SettingsViewModel
import com.tabaaq.mobile.ui.signin.SignInScreen
import com.tabaaq.mobile.ui.signin.SignInViewModel

private sealed interface AppRoute {
    data object SignIn : AppRoute

    data object Home : AppRoute

    data object Products : AppRoute

    data object Settings : AppRoute
}

private data class Tab(
    val route: AppRoute,
    val label: Int,
    val icon: ImageVector,
)

@Composable
fun TabaaqApp(container: AppContainer) {
    val session =
        viewModel<SessionViewModel>(
            factory = SessionViewModel.factory(container.authRepository, container.powerSync),
        )
    val auth by session.authState.collectAsStateWithLifecycle()
    when (auth) {
        AuthState.Loading -> Scaffold(Modifier.fillMaxSize()) { }
        AuthState.SignedOut -> {
            val signIn =
                viewModel<SignInViewModel>(
                    factory = SignInViewModel.factory(container.authRepository, container.googleSignIn, container.config),
                )
            SignInScreen(signIn)
        }
        is AuthState.SignedIn -> SignedInShell(container)
    }
}

@Composable
private fun SignedInShell(container: AppContainer) {
    val tabs =
        listOf(
            Tab(AppRoute.Home, R.string.nav_home, Icons.Outlined.Home),
            Tab(AppRoute.Products, R.string.nav_products, Icons.Outlined.Inventory2),
            Tab(AppRoute.Settings, R.string.nav_settings, Icons.Outlined.Settings),
        )
    val backStack = remember { mutableStateListOf<AppRoute>(AppRoute.Home) }
    val current = backStack.last()
    val catalog =
        viewModel<CatalogViewModel>(
            factory = CatalogViewModel.factory(container.authRepository, container.powerSync),
        )
    val settings =
        viewModel<SettingsViewModel>(
            factory = SettingsViewModel.factory(container.authRepository),
        )

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab.route,
                        onClick = {
                            if (current != tab.route) {
                                backStack.clear()
                                backStack.add(tab.route)
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = stringResource(tab.label)) },
                        label = { Text(stringResource(tab.label)) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavDisplay(
            backStack = backStack,
            onBack = { if (backStack.size > 1) backStack.removeLastOrNull() },
            entryProvider = { key ->
                when (key) {
                    AppRoute.Home -> NavEntry(key) { HomeScreen(catalog, innerPadding) }
                    AppRoute.Products -> NavEntry(key) { CatalogScreen(catalog, innerPadding) }
                    AppRoute.Settings ->
                        NavEntry(key) {
                            SettingsScreen(container, catalog, innerPadding, settings::signOut)
                        }
                    AppRoute.SignIn -> NavEntry(key) { }
                }
            },
        )
    }
}
