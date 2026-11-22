type AcceleratorInput = {
  readonly type: string;
  readonly key: string;
  readonly code?: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};

export const isNewSaleAccelerator = (input: AcceleratorInput): boolean => {
  if (input.type !== "keyDown") return false;
  const isN = input.code === "KeyN" || input.key.toLowerCase() === "n";
  if (!isN) return false;
  return (input.control || input.meta) && !input.alt && !input.shift;
};
