package com.tabaaq.mobile.data.auth

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.google.common.truth.Truth.assertThat
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceOrganization
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import com.tabaaq.mobile.core.auth.WorkspaceUser
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DataStoreTokenStoreTest {
    private val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    private lateinit var scope: CoroutineScope
    private lateinit var file: File
    private lateinit var store: DataStoreTokenStore

    @Before
    fun setUp() {
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        file = File.createTempFile("tabaaq-auth", ".preferences_pb").also { it.delete() }
        store =
            DataStoreTokenStore(
                PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }),
                json,
            )
    }

    @After
    fun tearDown() {
        scope.cancel()
        file.delete()
        File("${file.absolutePath}.tmp").delete()
    }

    @Test
    fun tokensRoundTripAndClear() =
        runBlocking {
            assertThat(store.readTokens()).isNull()
            val tokens = TokenSet("access", 1_000, "refresh", 2_000)
            store.writeTokens(tokens)
            assertThat(store.readTokens()).isEqualTo(tokens)
            store.writeTokens(null)
            assertThat(store.readTokens()).isNull()
        }

    @Test
    fun workspaceRoundTripAndClear() =
        runBlocking {
            val workspace =
                WorkspaceSnapshot(
                    status = "authenticated",
                    user = WorkspaceUser("u1", "Owner", "owner@tabaaq.app"),
                    activeOrganization = WorkspaceOrganization("org1", "Store", role = "owner"),
                )
            store.writeWorkspace(workspace)
            assertThat(store.readWorkspace()).isEqualTo(workspace)
            store.writeWorkspace(null)
            assertThat(store.readWorkspace()).isNull()
        }

    @Test
    fun deviceIdIsStableAndSurvivesLogout() =
        runBlocking {
            val first = store.deviceId()
            assertThat(first).isNotEmpty()
            assertThat(store.deviceId()).isEqualTo(first)
            store.writeTokens(TokenSet("access", 1_000, "refresh", 2_000))
            store.writeTokens(null)
            store.writeWorkspace(null)
            assertThat(store.deviceId()).isEqualTo(first)
        }
}
