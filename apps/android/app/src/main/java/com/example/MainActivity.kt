package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.work.WorkManager
import com.example.auth.AppSessionState
import com.example.auth.AuthViewModel
import com.example.auth.AuthViewModelFactory
import com.example.auth.OrganizationPickerScreen
import com.example.auth.SignInScreen
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import com.example.ui.AccountScreen
import com.example.ui.ProductApp
import com.example.ui.ProductViewModel
import com.example.ui.ProductViewModelFactory
import com.example.ui.theme.MyApplicationTheme
import kotlinx.serialization.Serializable

private object Routes {
    @Serializable
    object Loading

    @Serializable
    object SignIn

    @Serializable
    object OrganizationPicker

    @Serializable
    object Main
}

private enum class MainDestination(val label: String) {
    Products("Products"),
    Account("Account"),
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as StoreApplication
        val workManager = WorkManager.getInstance(applicationContext)

        val authViewModel = ViewModelProvider(
            this,
            AuthViewModelFactory(app.authRepository, app.sessionStore, app.credentialAuthManager, workManager),
        )[AuthViewModel::class.java]

        val productViewModel = ViewModelProvider(
            this,
            ProductViewModelFactory(
                app.productRepository,
                TextRecognitionService(),
                GeminiParsingService(),
                workManager,
            ),
        )[ProductViewModel::class.java]

        setContent {
            MyApplicationTheme {
                AppRoot(authViewModel = authViewModel, productViewModel = productViewModel)
            }
        }
    }
}

@Composable
private fun AppRoot(authViewModel: AuthViewModel, productViewModel: ProductViewModel) {
    val sessionState by authViewModel.sessionState.collectAsStateWithLifecycle()
    val isBusy by authViewModel.isBusy.collectAsStateWithLifecycle()
    val error by authViewModel.error.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var attemptedSilentSignIn by remember { mutableStateOf(false) }

    val navController = rememberNavController()

    LaunchedEffect(sessionState) {
        val destination = when (sessionState) {
            AppSessionState.Loading -> Routes.Loading
            AppSessionState.SignedOut -> Routes.SignIn
            is AppSessionState.NeedsOrganization -> Routes.OrganizationPicker
            AppSessionState.Ready -> Routes.Main
        }
        navController.navigate(destination) {
            popUpTo(0) { inclusive = true }
            launchSingleTop = true
        }
    }

    NavHost(navController = navController, startDestination = Routes.Loading) {
        composable<Routes.Loading> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }

        composable<Routes.SignIn> {
            LaunchedEffect(Unit) {
                if (!attemptedSilentSignIn) {
                    attemptedSilentSignIn = true
                    authViewModel.trySilentSignIn(context)
                }
            }
            SignInScreen(
                isBusy = isBusy,
                error = error,
                onSignIn = { email, password, activityContext ->
                    authViewModel.signIn(activityContext, email, password)
                },
            )
        }

        composable<Routes.OrganizationPicker> {
            val state = sessionState
            val organizations = (state as? AppSessionState.NeedsOrganization)?.organizations.orEmpty()
            OrganizationPickerScreen(
                organizations = organizations,
                onSelect = { authViewModel.selectOrganization(it) },
            )
        }

        composable<Routes.Main> {
            MainScreen(authViewModel = authViewModel, productViewModel = productViewModel)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(authViewModel: AuthViewModel, productViewModel: ProductViewModel) {
    var destination by rememberSaveable { mutableStateOf(MainDestination.Products) }
    val activeOrganization by authViewModel.activeOrganization.collectAsStateWithLifecycle()
    val syncPhase by productViewModel.syncPhase.collectAsStateWithLifecycle()

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            item(
                selected = destination == MainDestination.Products,
                onClick = { destination = MainDestination.Products },
                icon = { Icon(Icons.Filled.Inventory2, contentDescription = null) },
                label = { Text(MainDestination.Products.label) },
            )
            item(
                selected = destination == MainDestination.Account,
                onClick = { destination = MainDestination.Account },
                icon = { Icon(Icons.Filled.AccountCircle, contentDescription = null) },
                label = { Text(MainDestination.Account.label) },
            )
        },
    ) {
        when (destination) {
            MainDestination.Products -> ProductApp(viewModel = productViewModel)
            MainDestination.Account -> AccountScreen(
                organization = activeOrganization,
                syncPhase = syncPhase,
                onSignOut = { authViewModel.signOut() },
            )
        }
    }
}
