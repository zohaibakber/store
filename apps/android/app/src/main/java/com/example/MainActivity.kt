package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.work.WorkManager
import com.example.auth.AppSessionState
import com.example.auth.AuthViewModel
import com.example.auth.AuthViewModelFactory
import com.example.auth.OrganizationPickerScreen
import com.example.auth.SignInScreen
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import com.example.ui.ProductApp
import com.example.ui.ProductViewModel
import com.example.ui.ProductViewModelFactory
import com.example.ui.theme.MyApplicationTheme

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

    when (val state = sessionState) {
        AppSessionState.Loading -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }

        AppSessionState.SignedOut -> {
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

        is AppSessionState.NeedsOrganization -> {
            OrganizationPickerScreen(
                organizations = state.organizations,
                onSelect = { authViewModel.selectOrganization(it) },
            )
        }

        AppSessionState.Ready -> {
            ProductApp(viewModel = productViewModel, onSignOut = { authViewModel.signOut() })
        }
    }
}
