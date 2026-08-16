export interface TextExtractorModule {
  readonly isSupported: boolean;
  readonly extractTextFromImage: (uri: string) => Promise<string[]>;
}

export const createTextExtractor = (module: TextExtractorModule | null) => ({
  isTextRecognitionSupported: module?.isSupported === true,
  extractTextFromImage: (uri: string) => {
    if (!module) {
      throw new Error("Text recognition is not available in this app build.");
    }
    return module.extractTextFromImage(uri.replace("file://", ""));
  },
});
