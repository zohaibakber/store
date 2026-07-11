import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Kbd } from "./ui/kbd";

export function SearchForm({ ...props }: React.ComponentProps<"form">) {
  return (
    <form {...props}>
      <InputGroup>
        <InputGroupAddon>
          <HugeiconsIcon icon={SearchIcon} />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search" />
        <InputGroupAddon align={"inline-end"}>
          <Kbd>/</Kbd>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
