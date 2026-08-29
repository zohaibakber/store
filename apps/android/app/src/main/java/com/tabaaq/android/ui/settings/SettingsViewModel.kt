package com.tabaaq.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.android.data.auth.AuthRepository
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val auth: AuthRepository,
) : ViewModel() {
    fun signOut() {
        viewModelScope.launch { auth.signOut() }
    }

    companion object {
        fun factory(auth: AuthRepository) =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = SettingsViewModel(auth) as T
            }
    }
}
