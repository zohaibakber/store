import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";
import { useCommandMenu } from "./command-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Kbd } from "./ui/kbd";

export function SearchForm() {
  const { open } = useCommandMenu();
  return (
    <button type="button" onClick={open} className="w-full text-left">
      <InputGroup className="cursor-pointer">
        <InputGroupAddon>
          <HugeiconsIcon icon={SearchIcon} />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search" />
        <InputGroupAddon align={"inline-end"}>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </InputGroupAddon>
      </InputGroup>
    </button>
  );
}
