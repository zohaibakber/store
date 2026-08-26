export const analyseInvoices = async (
  files: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly bytes: ArrayBuffer;
  }>,
) => {
  if (!window.serverApi) throw new Error("Invoice analysis is unavailable in this build.");
  return window.serverApi.analyseInvoices({ files: [...files] });
};
