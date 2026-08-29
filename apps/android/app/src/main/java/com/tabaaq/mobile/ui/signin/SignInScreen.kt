package com.tabaaq.mobile.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.auth.LoginRoute

@Composable
fun SignInScreen(viewModel: SignInViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Scaffold { innerPadding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.sign_in_title), style = MaterialTheme.typography.headlineMedium)
            Text(stringResource(R.string.sign_in_subtitle), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (ui.error != null) {
                Text(ui.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            when (val route = ui.route) {
                null ->
                    IdentifierStep(
                        email = ui.email,
                        busy = ui.busy,
                        onEmail = viewModel::setEmail,
                        onContinue = viewModel::continueWithEmail,
                    )
                is LoginRoute.Password ->
                    PasswordStep(
                        email = route.email,
                        password = ui.password,
                        busy = ui.busy,
                        onPassword = viewModel::setPassword,
                        onSubmit = viewModel::submit,
                        onBack = viewModel::startOver,
                    )
                is LoginRoute.Otp ->
                    OtpStep(
                        email = route.email,
                        code = ui.code,
                        busy = ui.busy,
                        onCode = viewModel::setCode,
                        onSubmit = viewModel::submit,
                        onResend = viewModel::resendCode,
                        onBack = viewModel::startOver,
                    )
                is LoginRoute.Registration ->
                    RegistrationStep(
                        email = route.email,
                        name = ui.name,
                        password = ui.password,
                        busy = ui.busy,
                        onName = viewModel::setName,
                        onPassword = viewModel::setPassword,
                        onSubmit = viewModel::submit,
                        onBack = viewModel::startOver,
                    )
            }
            if (ui.googleConfigured && ui.route == null) {
                OutlinedButton(
                    onClick = { viewModel.continueWithGoogle(context) },
                    enabled = !ui.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.google_sign_in))
                }
            }
            if (ui.busy) {
                CircularProgressIndicator()
            }
        }
    }
}

@Composable
private fun IdentifierStep(
    email: String,
    busy: Boolean,
    onEmail: (String) -> Unit,
    onContinue: () -> Unit,
) {
    OutlinedTextField(
        value = email,
        onValueChange = onEmail,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.email_label)) },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onContinue() }),
    )
    Button(onClick = onContinue, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.continue_email))
    }
}

@Composable
private fun PasswordStep(
    email: String,
    password: String,
    busy: Boolean,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
) {
    Text(email, style = MaterialTheme.typography.bodyMedium)
    OutlinedTextField(
        value = password,
        onValueChange = onPassword,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.password_label)) },
        singleLine = true,
        enabled = !busy,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.sign_in))
    }
    TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.use_another_email)) }
}

@Composable
private fun OtpStep(
    email: String,
    code: String,
    busy: Boolean,
    onCode: (String) -> Unit,
    onSubmit: () -> Unit,
    onResend: () -> Unit,
    onBack: () -> Unit,
) {
    Text(email, style = MaterialTheme.typography.bodyMedium)
    OutlinedTextField(
        value = code,
        onValueChange = onCode,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.otp_label)) },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.verify_code))
    }
    TextButton(onClick = onResend, enabled = !busy) { Text(stringResource(R.string.resend_code)) }
    TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.use_another_email)) }
}

@Composable
private fun RegistrationStep(
    email: String,
    name: String,
    password: String,
    busy: Boolean,
    onName: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
) {
    Text(email, style = MaterialTheme.typography.bodyMedium)
    OutlinedTextField(
        value = name,
        onValueChange = onName,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.name_label)) },
        singleLine = true,
        enabled = !busy,
    )
    Spacer(Modifier.height(4.dp))
    OutlinedTextField(
        value = password,
        onValueChange = onPassword,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.password_label)) },
        singleLine = true,
        enabled = !busy,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.create_account))
    }
    TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.use_another_email)) }
}
