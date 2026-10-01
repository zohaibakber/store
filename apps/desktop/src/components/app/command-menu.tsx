import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

type CommandDialog = ComponentType<{ readonly onOpenChange: (open: boolean) => void }>;

const loadCommandDialog = (): Promise<CommandDialog> =>
  import("@/components/app/command-menu-dialog").then((module) => module.InventoryCommandDialog);

interface CommandMenuContextValue {
  readonly open: () => void;
  readonly preload: () => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu(): CommandMenuContextValue {
  const context = useContext(CommandMenuContext);
  if (!context) throw new Error("useCommandMenu must be used within a CommandMenuProvider");
  return context;
}

export function CommandMenuProvider({ children }: { readonly children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [Dialog, setDialog] = useState<CommandDialog | null>(null);
  const preload = useCallback(() => {
    void loadCommandDialog().then((loaded) => setDialog(() => loaded));
  }, []);
  const open = useCallback(() => {
    preload();
    setIsOpen(true);
  }, [preload]);
  const context = useMemo(() => ({ open, preload }), [open, preload]);

  useEffect(() => {
    const handle = requestIdleCallback(preload);
    return () => cancelIdleCallback(handle);
  }, [preload]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      event.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <CommandMenuContext.Provider value={context}>
      {children}
      {isOpen && Dialog ? <Dialog onOpenChange={setIsOpen} /> : null}
    </CommandMenuContext.Provider>
  );
}
