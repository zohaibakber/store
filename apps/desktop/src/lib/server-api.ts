export const analyseInvoices = async (
  files: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly bytes: ArrayBuffer;
  }>,
) => {
  if (!window.serverApi) throw new Error("Desktop server bridge is unavailable.");
  return window.serverApi.analyseInvoices({ files: [...files] });
};
