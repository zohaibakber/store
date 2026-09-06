package com.tabaaq.mobile.core.inventory

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ReplicaNameTest {
    @Test
    fun matchesJavascriptClientDbHashes() {
        assertThat(ReplicaName.databaseFile("https://api.example:org-1"))
            .isEqualTo("powersync-inventory-0b48b550.sqlite")
        assertThat(ReplicaName.databaseFile("https://api.example:org-2"))
            .isEqualTo("powersync-inventory-0e48ba09.sqlite")
        assertThat(ReplicaName.databaseFile("https://api.tabaaq.app:org-abc"))
            .isEqualTo("powersync-inventory-653c9f2c.sqlite")
    }

    @Test
    fun scopesByApiOriginAndOrganization() {
        val first = ReplicaName.scope("https://api.example.com/", "org-1")
        val second = ReplicaName.scope("https://api.example.com", "org-1")
        val other = ReplicaName.scope("https://api.example.com", "org-2")
        assertThat(first).isEqualTo("https://api.example.com:org-1")
        assertThat(first).isEqualTo(second)
        assertThat(other).isEqualTo("https://api.example.com:org-2")
    }
}
