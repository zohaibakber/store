package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import com.example.data.MedicineDatabase
import com.example.data.MedicineRepository
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import com.example.ui.MedicineApp
import com.example.ui.MedicineViewModel
import com.example.ui.MedicineViewModelFactory
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        val database = MedicineDatabase.getDatabase(this)
        val repository = MedicineRepository(database.medicineDao())
        val textRecognitionService = TextRecognitionService()
        val geminiParsingService = GeminiParsingService()
        val factory = MedicineViewModelFactory(repository, textRecognitionService, geminiParsingService)
        val viewModel = ViewModelProvider(this, factory)[MedicineViewModel::class.java]
        
        setContent {
            MyApplicationTheme {
                MedicineApp(viewModel = viewModel)
            }
        }
    }
}
