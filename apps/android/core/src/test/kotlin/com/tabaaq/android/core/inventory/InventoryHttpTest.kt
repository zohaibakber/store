package com.tabaaq.android.core.inventory

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class InventoryHttpTest {
    @Test
    fun apiRootAddsApiOnce() {
        assertThat(InventoryHttp.apiRoot("https://api.example.com")).isEqualTo("https://api.example.com/api")
        assertThat(InventoryHttp.apiRoot("https://api.example.com/")).isEqualTo("https://api.example.com/api")
        assertThat(InventoryHttp.apiRoot("https://api.example.com/api")).isEqualTo("https://api.example.com/api")
        assertThat(InventoryHttp.apiRoot("https://api.example.com/api/")).isEqualTo("https://api.example.com/api")
    }
}
