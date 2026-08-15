import { requireOptionalNativeModule } from "expo";

import {
  createTextExtractor,
  type TextExtractorModule,
} from "@/features/product-scanner/text-extractor-core";

const textExtractor = requireOptionalNativeModule<TextExtractorModule>("ExpoTextExtractor");

export const { extractTextFromImage, isTextRecognitionSupported } =
  createTextExtractor(textExtractor);
