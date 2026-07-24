import { SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommandMenu } from "@/components/command-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function SearchForm() {
  const { open } = useCommandMenu();
  return (
    <InputGroup onClick={open}>
      <InputGroupInput
        readOnly
        placeholder="Search"
        aria-keyshortcuts="/"
        aria-haspopup="dialog"
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        }}
      />
      <InputGroupAddon align="inline-start">
        <HugeiconsIcon icon={SearchIcon} />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <KbdGroup>
          <Kbd>/</Kbd>
        </KbdGroup>
      </InputGroupAddon>
    </InputGroup>
  );
}
