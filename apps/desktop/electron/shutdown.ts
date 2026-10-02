interface BeforeQuitEvent {
  readonly preventDefault: () => void;
}

interface ShutdownCoordinatorOptions {
  readonly dispose: () => Promise<void>;
  readonly quit: () => void;
  readonly reportError: (cause: unknown) => void;
}

export const makeShutdownCoordinator = (options: ShutdownCoordinatorOptions) => {
  let completed = false;
  let pending: Promise<void> | undefined;

  return (event: BeforeQuitEvent) => {
    if (completed) return;
    event.preventDefault();
    if (pending) return;
    pending = options
      .dispose()
      .catch((cause) => options.reportError(cause))
      .then(() => {
        completed = true;
        options.quit();
      });
  };
};
