package com.tabaaq.mobile.core.scan

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ScanNormalizeTest {
    @Test
    fun salvageFixesConcatenatedPackFactors() {
        assertThat(ScanNormalize.salvageUnitsPerPack("Pack 10x10", 1010)).isEqualTo(100)
        assertThat(ScanNormalize.salvageUnitsPerPack("Pack 10x10", 100)).isEqualTo(100)
    }

    @Test
    fun decodeNormalizesGeminiJson() {
        val result =
            ScanNormalize.decode(
                """
                {"name":"  Amoxil  ","composition":"Amoxicillin","strength":"500mg","unitsPerPack":10,"batchNumber":"ab12","expiresAt":"12/2027","confidence":0.81}
                """.trimIndent(),
            )
        assertThat(result?.name).isEqualTo("Amoxil")
        assertThat(result?.batchNumber).isEqualTo("AB12")
        assertThat(result?.expiresAt).isEqualTo("2027-12-31")
    }

    @Test
    fun decodeRejectsBadConfidence() {
        assertThat(ScanNormalize.decode("""{"name":"X","confidence":1.4}""")).isNull()
    }
}
