import { useNavigate } from "@tanstack/react-router";
import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@/components/ui/command";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  HomeIcon,
  Invoice01Icon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";

type CommandRoute =
  | "/"
  | "/products"
  | "/invoices"
  | "/settings"
  | "/search"
  | "/products/new"
  | "/products/upload"
  | "/invoices/new";

// coss command items carry no icon sizing of their own (unlike the shadcn/cmdk
// item they replaced), so hugeicons would render at their natural 24px.
const CommandIcon = ({ icon }: { icon: React.ComponentProps<typeof HugeiconsIcon>["icon"] }) => (
  <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={icon} />
);

interface CommandEntry {
  readonly value: CommandRoute;
  readonly label: string;
  readonly icon: React.ReactNode;
}

interface CommandGroupEntry {
  readonly value: string;
  readonly items: ReadonlyArray<CommandEntry>;
}

const commandGroups: ReadonlyArray<CommandGroupEntry> = [
  {
    value: "Links",
    items: [
      { value: "/", label: "Home", icon: <CommandIcon icon={HomeIcon} /> },
      { value: "/products", label: "Products", icon: <CommandIcon icon={TagIcon} /> },
      { value: "/invoices", label: "Invoices", icon: <CommandIcon icon={Invoice01Icon} /> },
      { value: "/settings", label: "Settings", icon: <CommandIcon icon={SettingsIcon} /> },
    ],
  },
  {
    value: "Actions",
    items: [
      { value: "/search", label: "Search products", icon: <CommandIcon icon={SearchIcon} /> },
      { value: "/products/new", label: "New product", icon: <CommandIcon icon={Add01Icon} /> },
      {
        value: "/products/upload",
        label: "Import products",
        icon: <CommandIcon icon={Upload01Icon} />,
      },
      { value: "/invoices/new", label: "New invoice", icon: <CommandIcon icon={Add01Icon} /> },
    ],
  },
];

const matchesLabel = (itemValue: unknown, query: string) =>
  (itemValue as CommandEntry).label.toLowerCase().includes(query.trim().toLowerCase());

interface CommandMenuContextValue {
  readonly open: () => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu(): CommandMenuContextValue {
  const context = useContext(CommandMenuContext);
  if (!context) throw new Error("useCommandMenu must be used within a CommandMenuProvider");
  return context;
}

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const open = useCallback(() => setIsOpen(true), []);

  // Slash opens the palette unless the user is already typing in an editable control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("select") ||
          (target.matches("input, textarea") && !target.hasAttribute("readonly")));

      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isEditable) return;

      event.preventDefault();
      setIsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  // Product search lives on its own page (/search) where the Autocomplete has
  // room for prices and stock; the palette only routes there.
  const handleNavigate = (url: CommandRoute) => {
    setIsOpen(false);
    void navigate({ to: url });
  };

  return (
    <CommandMenuContext.Provider value={{ open }}>
      {children}
      <CommandDialog open={isOpen} onOpenChange={setIsOpen}>
        <CommandDialogPopup aria-label="Command menu">
          <Command
            filter={matchesLabel}
            items={commandGroups}
            onValueChange={setQuery}
            value={query}
          >
            <CommandInput placeholder="Search or jump to…" />
            <CommandPanel>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandList>
                {(group: CommandGroupEntry) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: CommandEntry) => (
                          <CommandItem
                            className="gap-2"
                            key={item.value}
                            onClick={() => handleNavigate(item.value)}
                            value={item.value}
                          >
                            {item.icon}
                            <span>{item.label}</span>
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </CommandMenuContext.Provider>
  );
}
