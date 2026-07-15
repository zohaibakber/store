import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";
import { useCommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function SearchForm() {
  const { open } = useCommandMenu();
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-start"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={open}
    >
      <HugeiconsIcon data-icon="inline-start" icon={SearchIcon} />
      <span>Search</span>
      <KbdGroup className="ml-auto">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </Button>
  );
}
