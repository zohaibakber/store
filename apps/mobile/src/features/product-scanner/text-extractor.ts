import { requireOptionalNativeModule } from "expo";

type TextExtractorModule = {
  readonly isSupported: boolean;
  readonly extractTextFromImage: (uri: string) => Promise<string[]>;
};

const textExtractor = requireOptionalNativeModule<TextExtractorModule>("ExpoTextExtractor");

export const isTextRecognitionSupported = textExtractor?.isSupported === true;

export const extractTextFromImage = (uri: string) => {
  if (!textExtractor) {
    throw new Error("Text recognition is not available in this app build.");
  }
  return textExtractor.extractTextFromImage(uri.replace("file://", ""));
};
