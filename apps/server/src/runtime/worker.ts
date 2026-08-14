export const reportError = (event: string, cause: unknown) => {
  console.error(
    JSON.stringify({
      event,
      message: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    }),
  );
};
