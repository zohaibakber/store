package com.tabaaq.mobile.ui.navigation

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.data.auth.AuthState
import com.tabaaq.mobile.di.AppContainer
import com.tabaaq.mobile.ui.catalog.CatalogScreen
import com.tabaaq.mobile.ui.catalog.CatalogViewModel
import com.tabaaq.mobile.ui.home.HomeScreen
import com.tabaaq.mobile.ui.product.ProductDetailScreen
import com.tabaaq.mobile.ui.product.ProductDetailViewModel
import com.tabaaq.mobile.ui.product.ProductEditorScreen
import com.tabaaq.mobile.ui.product.ProductEditorViewModel
import com.tabaaq.mobile.ui.scan.ScanScreen
import com.tabaaq.mobile.ui.scan.ScanViewModel
import com.tabaaq.mobile.ui.session.SessionViewModel
import com.tabaaq.mobile.ui.settings.SettingsScreen
import com.tabaaq.mobile.ui.settings.SettingsViewModel
import com.tabaaq.mobile.ui.signin.SignInScreen
import com.tabaaq.mobile.ui.signin.SignInViewModel
import com.tabaaq.mobile.ui.theme.AppMotion
import kotlinx.serialization.Serializable

@Serializable
private sealed interface AppRoute : NavKey {
    @Serializable
    data object SignIn : AppRoute

    @Serializable
    data object Home : AppRoute

    @Serializable
    data object Products : AppRoute

    @Serializable
    data object Settings : AppRoute

    @Serializable
    data class Product(val id: String) : AppRoute

    @Serializable
    data class NewProduct(val draft: ProductScanResult? = null) : AppRoute

    @Serializable
    data object Scan : AppRoute
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
            factory = SessionViewModel.factory(container.authRepository, container.catalogSync),
        )
    val auth by session.authState.collectAsStateWithLifecycle()
    when (auth) {
        AuthState.Loading -> {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
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
    val backStack = rememberNavBackStack(AppRoute.Home)
    val current = backStack.last()
    val spatialSpec = AppMotion.defaultSpatial<IntOffset>()
    val effectsSpec = AppMotion.defaultEffects<Float>()
    val showTabs = current is AppRoute.Home || current is AppRoute.Products || current is AppRoute.Settings
    val catalog =
        viewModel<CatalogViewModel>(
            factory = CatalogViewModel.factory(container.authRepository, container.catalogSync),
        )
    val settings =
        viewModel<SettingsViewModel>(
            factory = SettingsViewModel.factory(container.authRepository),
        )

    fun openTab(route: AppRoute) {
        backStack.clear()
        backStack.add(route)
    }

    fun openProduct(id: String) {
        backStack.removeAll { it is AppRoute.Product || it is AppRoute.NewProduct || it is AppRoute.Scan }
        backStack.add(AppRoute.Product(id))
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
        bottomBar = {
            if (showTabs) {
                NavigationBar {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = current == tab.route,
                            onClick = { if (current != tab.route) openTab(tab.route) },
                            icon = { Icon(tab.icon, contentDescription = stringResource(tab.label)) },
                            label = { Text(stringResource(tab.label)) },
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        NavDisplay(
            backStack = backStack,
            onBack = { if (backStack.size > 1) backStack.removeLastOrNull() },
            entryDecorators =
                listOf(
                    rememberSaveableStateHolderNavEntryDecorator(),
                    rememberViewModelStoreNavEntryDecorator(),
                ),
            transitionSpec = {
                (slideInHorizontally(spatialSpec) { it / 5 } + fadeIn(effectsSpec)) togetherWith
                    (slideOutHorizontally(spatialSpec) { -it / 12 } + fadeOut(effectsSpec))
            },
            popTransitionSpec = {
                (slideInHorizontally(spatialSpec) { -it / 5 } + fadeIn(effectsSpec)) togetherWith
                    (slideOutHorizontally(spatialSpec) { it / 12 } + fadeOut(effectsSpec))
            },
            predictivePopTransitionSpec = { _ ->
                (slideInHorizontally(spatialSpec) { -it / 5 } + fadeIn(effectsSpec)) togetherWith
                    (slideOutHorizontally(spatialSpec) { it / 12 } + fadeOut(effectsSpec))
            },
            entryProvider = { key ->
                when (key) {
                    AppRoute.Home ->
                        NavEntry(key) {
                            HomeScreen(
                                viewModel = catalog,
                                contentPadding = innerPadding,
                                onOpenProduct = ::openProduct,
                                onOpenProducts = { openTab(AppRoute.Products) },
                                onScan = { backStack.add(AppRoute.Scan) },
                            )
                        }
                    AppRoute.Products ->
                        NavEntry(key) {
                            CatalogScreen(
                                viewModel = catalog,
                                contentPadding = innerPadding,
                                onOpenProduct = ::openProduct,
                                onScan = { backStack.add(AppRoute.Scan) },
                                onAdd = { backStack.add(AppRoute.NewProduct()) },
                            )
                        }
                    AppRoute.Settings ->
                        NavEntry(key) {
                            SettingsScreen(container, catalog, innerPadding, settings::signOut)
                        }
                    is AppRoute.Product ->
                        NavEntry(key) {
                            val detail =
                                viewModel<ProductDetailViewModel>(
                                    key = key.id,
                                    factory = ProductDetailViewModel.factory(key.id, container.catalogRepository, container.catalogSync),
                                )
                            ProductDetailScreen(
                                detail,
                                contentPadding = innerPadding,
                                onBack = { backStack.removeLastOrNull() },
                            )
                        }
                    is AppRoute.NewProduct ->
                        NavEntry(key) {
                            val editor =
                                viewModel<ProductEditorViewModel>(
                                    key = "new-${key.draft?.name}",
                                    factory = ProductEditorViewModel.factory(container.catalogRepository, container.catalogSync, key.draft),
                                )
                            ProductEditorScreen(
                                editor,
                                onBack = { backStack.removeLastOrNull() },
                                onCreated = ::openProduct,
                            )
                        }
                    AppRoute.Scan ->
                        NavEntry(key) {
                            val scan =
                                viewModel<ScanViewModel>(
                                    factory = ScanViewModel.factory(container.productScan, container.catalogSync),
                                )
                            ScanScreen(
                                viewModel = scan,
                                onBack = { backStack.removeLastOrNull() },
                                onCreateFromScan = { draft ->
                                    backStack.removeLastOrNull()
                                    backStack.add(AppRoute.NewProduct(draft))
                                },
                                onOpenProduct = ::openProduct,
                            )
                        }
                    AppRoute.SignIn -> NavEntry(key) { }
                    else -> error("Unknown route: $key")
                }
            },
        )
    }
}
