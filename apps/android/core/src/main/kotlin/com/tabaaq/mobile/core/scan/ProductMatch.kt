package com.tabaaq.mobile.core.scan

import com.tabaaq.mobile.core.catalog.CatalogProduct
import java.text.Normalizer

object ProductMatch {
    fun find(
        products: List<CatalogProduct>,
        result: ProductScanResult,
        recognizedText: String,
    ): CatalogProduct? {
        val ranked =
            products
                .map { it to score(it, result, recognizedText) }
                .sortedByDescending { it.second }
        val best = ranked.firstOrNull() ?: return null
        val runnerUp = ranked.getOrNull(1)
        if (best.second < 0.5) return null
        if (runnerUp != null && best.second - runnerUp.second < 0.08) return null
        return best.first
    }

    internal fun score(
        product: CatalogProduct,
        result: ProductScanResult,
        recognizedText: String,
    ): Double {
        val productName = normalized(product.name)
        val inferredName = normalized(result.name)
        val ocr = normalized(recognizedText)
        var score = 0.0
        score +=
            when {
                inferredName.isNotEmpty() && inferredName == productName -> 0.68
                productName.length >= 3 && ocr.contains(productName) -> 0.62
                inferredName.isNotEmpty() -> overlap(productName, inferredName) * 0.64
                else -> 0.0
            }
        val inferredComposition = normalized(result.composition)
        val productComposition = normalized(product.composition)
        if (inferredComposition.isNotEmpty() && productComposition.isNotEmpty()) {
            val compositionScore =
                if (inferredComposition == productComposition) 1.0 else overlap(productComposition, inferredComposition)
            score += compositionScore * 0.18
            if (compositionScore < 0.25) score -= 0.28
        }
        val inferredStrength = normalized(result.strength)
        val productStrength = normalized(product.strength)
        if (inferredStrength.isNotEmpty() && productStrength.isNotEmpty()) {
            score += if (inferredStrength == productStrength) 0.24 else -0.55
        }
        if (result.unitsPerPack != null) {
            score += if (result.unitsPerPack == product.unitsPerPack) 0.22 else -0.7
        }
        return score.coerceIn(0.0, 1.0)
    }

    private fun normalized(value: String?): String {
        if (value.isNullOrBlank()) return ""
        val decomposed = Normalizer.normalize(value, Normalizer.Form.NFKD).lowercase()
        return decomposed.replace(Regex("""[^\p{L}\p{N}]+"""), " ").trim()
    }

    private fun words(value: String): Set<String> = value.split(Regex("""\s+""")).filter { it.length > 1 }.toSet()

    private fun overlap(
        left: String,
        right: String,
    ): Double {
        val leftWords = words(left)
        val rightWords = words(right)
        if (leftWords.isEmpty() || rightWords.isEmpty()) return 0.0
        val shared = leftWords.count { it in rightWords }
        return shared.toDouble() / maxOf(leftWords.size, rightWords.size)
    }
}
