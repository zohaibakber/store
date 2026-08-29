package com.tabaaq.mobile.ui.signin

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabaaq.mobile.R
import com.tabaaq.mobile.core.auth.LoginRoute
import com.tabaaq.mobile.ui.theme.AppMotion
import com.tabaaq.mobile.ui.theme.EmphasizedTypography

@Composable
fun SignInScreen(viewModel: SignInViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val stage = ui.route.toAuthStage()

    Scaffold(containerColor = MaterialTheme.colorScheme.surfaceContainerLow) { innerPadding ->
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .imePadding(),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier =
                    Modifier
                        .widthIn(max = 520.dp)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                AuthBrand()
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.extraLarge,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        AuthHeading(stage = stage, route = ui.route, onBack = viewModel::startOver)
                        AnimatedVisibility(
                            visible = ui.error != null,
                            enter = fadeIn(AppMotion.fastEffects()) + slideInVertically(AppMotion.fastSpatial()) { -it / 3 },
                            exit = fadeOut(AppMotion.fastEffects()) + slideOutVertically(AppMotion.fastSpatial()) { -it / 3 },
                        ) {
                            Surface(
                                color = MaterialTheme.colorScheme.errorContainer,
                                contentColor = MaterialTheme.colorScheme.onErrorContainer,
                                shape = MaterialTheme.shapes.medium,
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                                    Text(ui.error.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                        AnimatedContent(
                            targetState = stage,
                            transitionSpec = {
                                (fadeIn(AppMotion.defaultEffects()) + scaleIn(AppMotion.defaultSpatial(), initialScale = 0.97f)) togetherWith
                                    (fadeOut(AppMotion.fastEffects()) + scaleOut(AppMotion.fastSpatial(), targetScale = 0.98f))
                            },
                            label = "Authentication step",
                        ) { currentStage ->
                            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                when (currentStage) {
                                    AuthStage.Identifier ->
                                        IdentifierStep(
                                            email = ui.email,
                                            busy = ui.busy,
                                            pending = ui.pending,
                                            googleConfigured = ui.googleConfigured,
                                            onEmail = viewModel::setEmail,
                                            onContinue = viewModel::continueWithEmail,
                                            onGoogle = { viewModel.continueWithGoogle(context) },
                                        )
                                    AuthStage.Password ->
                                        PasswordStep(
                                            password = ui.password,
                                            busy = ui.busy,
                                            onPassword = viewModel::setPassword,
                                            onSubmit = viewModel::submit,
                                        )
                                    AuthStage.Otp ->
                                        OtpStep(
                                            code = ui.code,
                                            busy = ui.busy,
                                            onCode = viewModel::setCode,
                                            onSubmit = viewModel::submit,
                                            onResend = viewModel::resendCode,
                                        )
                                    AuthStage.Registration ->
                                        RegistrationStep(
                                            name = ui.name,
                                            password = ui.password,
                                            busy = ui.busy,
                                            onName = viewModel::setName,
                                            onPassword = viewModel::setPassword,
                                            onSubmit = viewModel::submit,
                                        )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthBrand() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            shape = MaterialTheme.shapes.large,
        ) {
            Box(Modifier.size(50.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Inventory2, contentDescription = null, modifier = Modifier.size(26.dp))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text(stringResource(R.string.app_name), style = EmphasizedTypography.titleLarge)
            Text(
                stringResource(R.string.auth_brand_label),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun AuthHeading(
    stage: AuthStage,
    route: LoginRoute?,
    onBack: () -> Unit,
) {
    if (stage != AuthStage.Identifier) {
        TextButton(onClick = onBack, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.use_another_email))
        }
    }
    Text(
        text =
            stringResource(
                when (stage) {
                    AuthStage.Identifier -> R.string.sign_in_title
                    AuthStage.Password -> R.string.auth_welcome_back
                    AuthStage.Otp -> R.string.auth_check_inbox
                    AuthStage.Registration -> R.string.auth_create_profile
                },
            ),
        style = EmphasizedTypography.titleLarge,
    )
    Text(
        text =
            when (route) {
                is LoginRoute.Password -> stringResource(R.string.auth_continue_as, route.email)
                is LoginRoute.Otp -> stringResource(R.string.auth_code_sent, route.email)
                is LoginRoute.Registration -> stringResource(R.string.auth_new_account_for, route.email)
                null -> stringResource(R.string.sign_in_subtitle)
            },
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun IdentifierStep(
    email: String,
    busy: Boolean,
    pending: SignInPending?,
    googleConfigured: Boolean,
    onEmail: (String) -> Unit,
    onContinue: () -> Unit,
    onGoogle: () -> Unit,
) {
    if (googleConfigured) {
        OutlinedButton(onClick = onGoogle, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            ButtonLabel(busy = pending == SignInPending.Google, label = stringResource(R.string.google_sign_in))
        }
        Text(
            stringResource(R.string.auth_or),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
        )
    }
    AuthField(
        value = email,
        onValueChange = onEmail,
        label = stringResource(R.string.email_label),
        icon = Icons.Outlined.AlternateEmail,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onContinue() }),
    )
    Button(onClick = onContinue, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        ButtonLabel(busy = pending == SignInPending.Email, label = stringResource(R.string.continue_email))
    }
}

@Composable
private fun PasswordStep(
    password: String,
    busy: Boolean,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    var passwordVisible by rememberSaveable { mutableStateOf(false) }
    AuthField(
        value = password,
        onValueChange = onPassword,
        label = stringResource(R.string.password_label),
        icon = Icons.Outlined.Lock,
        enabled = !busy,
        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                Icon(
                    if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    contentDescription = stringResource(if (passwordVisible) R.string.hide_password else R.string.show_password),
                )
            }
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        ButtonLabel(busy = busy, label = stringResource(R.string.sign_in))
    }
}

@Composable
private fun OtpStep(
    code: String,
    busy: Boolean,
    onCode: (String) -> Unit,
    onSubmit: () -> Unit,
    onResend: () -> Unit,
) {
    AuthField(
        value = code,
        onValueChange = { onCode(it.filter(Char::isDigit).take(6)) },
        label = stringResource(R.string.otp_label),
        icon = Icons.Outlined.Key,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        ButtonLabel(busy = busy, label = stringResource(R.string.verify_code))
    }
    TextButton(onClick = onResend, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.resend_code))
    }
}

@Composable
private fun RegistrationStep(
    name: String,
    password: String,
    busy: Boolean,
    onName: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    var passwordVisible by rememberSaveable { mutableStateOf(false) }
    AuthField(
        value = name,
        onValueChange = onName,
        label = stringResource(R.string.name_label),
        icon = Icons.Outlined.Person,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
    )
    AuthField(
        value = password,
        onValueChange = onPassword,
        label = stringResource(R.string.password_label),
        icon = Icons.Outlined.Lock,
        enabled = !busy,
        supportingText = { Text(stringResource(R.string.auth_password_hint)) },
        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                Icon(
                    if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    contentDescription = stringResource(if (passwordVisible) R.string.hide_password else R.string.show_password),
                )
            }
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        ButtonLabel(busy = busy, label = stringResource(R.string.create_account))
    }
}

@Composable
private fun AuthField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    icon: ImageVector,
    enabled: Boolean,
    keyboardOptions: KeyboardOptions,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailingIcon: @Composable (() -> Unit)? = null,
    supportingText: @Composable (() -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = true,
        shape = MaterialTheme.shapes.large,
        label = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        trailingIcon = trailingIcon,
        supportingText = supportingText,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
    )
}

@Composable
private fun ButtonLabel(
    busy: Boolean,
    label: String,
) {
    if (busy) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
    }
    Text(label)
}

private enum class AuthStage {
    Identifier,
    Password,
    Otp,
    Registration,
}

private fun LoginRoute?.toAuthStage(): AuthStage =
    when (this) {
        null -> AuthStage.Identifier
        is LoginRoute.Password -> AuthStage.Password
        is LoginRoute.Otp -> AuthStage.Otp
        is LoginRoute.Registration -> AuthStage.Registration
    }
