export const casesHandled = (value: never): never => {
  throw new Error(`Unhandled migration case: ${String(value)}`);
};
