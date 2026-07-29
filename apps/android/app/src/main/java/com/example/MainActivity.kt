package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import com.example.data.ProductDatabase
import com.example.data.ProductRepository
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import com.example.ui.ProductApp
import com.example.ui.ProductViewModel
import com.example.ui.ProductViewModelFactory
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val database = ProductDatabase.getDatabase(this)
        val repository = ProductRepository(database.productDao())
        val textRecognitionService = TextRecognitionService()
        val geminiParsingService = GeminiParsingService()
        val factory = ProductViewModelFactory(repository, textRecognitionService, geminiParsingService)
        val viewModel = ViewModelProvider(this, factory)[ProductViewModel::class.java]

        setContent {
            MyApplicationTheme {
                ProductApp(viewModel = viewModel)
            }
        }
    }
}
