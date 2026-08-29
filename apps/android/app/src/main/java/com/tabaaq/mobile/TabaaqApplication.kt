package com.tabaaq.mobile

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabaaq.mobile.di.AppContainer

class TabaaqApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        runCatching { FirebaseApp.initializeApp(this) }
        container = AppContainer(this)
    }
}
