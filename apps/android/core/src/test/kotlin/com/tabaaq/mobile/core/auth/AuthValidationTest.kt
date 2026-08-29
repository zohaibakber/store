package com.tabaaq.mobile.core.auth

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class AuthValidationTest {
    @Test
    fun acceptsOrdinaryEmail() {
        assertThat(AuthValidation.isEmail("owner@tabaaq.app")).isTrue()
        assertThat(AuthValidation.normalizeEmail("  Owner@Tabaaq.APP ")).isEqualTo("owner@tabaaq.app")
    }

    @Test
    fun rejectsBrokenEmail() {
        assertThat(AuthValidation.isEmail("not-an-email")).isFalse()
        assertThat(AuthValidation.isEmail("a@b")).isFalse()
    }

    @Test
    fun passwordMustBeTrimmedAndLongEnough() {
        assertThat(AuthValidation.isPassword("short")).isFalse()
        assertThat(AuthValidation.isPassword("  longenoughpassword")).isFalse()
        assertThat(AuthValidation.isPassword("longenoughpassword")).isTrue()
    }

    @Test
    fun otpIsSixDigits() {
        assertThat(AuthValidation.isOtp("123456")).isTrue()
        assertThat(AuthValidation.isOtp("12345")).isFalse()
        assertThat(AuthValidation.isOtp("12345a")).isFalse()
    }
}
