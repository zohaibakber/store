import {
  ArrowDown01Icon,
  Invoice01Icon,
  Pdf01Icon,
  PrinterIcon,
  ReceiptTextIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { ShortcutButton } from "@/components/shared/shortcut-button";
import { Button } from "@/components/ui/button";
import { Group, GroupSeparator } from "@/components/ui/group";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { useReceiptFormat } from "@/hooks/use-receipt-format";
import type { ReceiptPaper } from "@/lib/receipt-format";
import { usePageShortcuts } from "@/lib/shortcuts";

import { usePrintReceipt, useReceiptPrinting, type ReceiptPrintJob } from "./print-host";

const PRINT_HINT = {
  a4: "Print the A4 invoice",
  thermal: "Print the thermal receipt",
} as const satisfies Record<ReceiptPaper, string>;

export function PrintReceiptAction({ invoiceId }: { readonly invoiceId: string }) {
  const print = usePrintReceipt();
  const printing = useReceiptPrinting();
  const { paper } = useReceiptFormat();

  const send = (chosen: ReceiptPaper, output: ReceiptPrintJob["output"] = "printer") => {
    if (!printing) print({ invoiceId, paper: chosen, output });
  };

  usePageShortcuts({ p: () => send(paper) });

  return (
    <Group>
      <ShortcutButton
        disabled={printing}
        label={PRINT_HINT[paper]}
        onClick={() => send(paper)}
        shortcut="P"
        variant="outline"
      >
        <HugeiconsIcon aria-hidden="true" icon={PrinterIcon} />
        Print
      </ShortcutButton>
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="More ways to print"
              disabled={printing}
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuItem onClick={() => send("a4")}>
              <HugeiconsIcon aria-hidden="true" icon={Invoice01Icon} />
              A4 invoice
            </MenuItem>
            <MenuItem onClick={() => send("thermal")}>
              <HugeiconsIcon aria-hidden="true" icon={ReceiptTextIcon} />
              Thermal receipt
            </MenuItem>
            <MenuItem onClick={() => send("a4", "pdf")}>
              <HugeiconsIcon aria-hidden="true" icon={Pdf01Icon} />
              Save as PDF
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuLinkItem render={<Link params={{ section: "receipts" }} to="/settings/$section" />}>
            <HugeiconsIcon aria-hidden="true" icon={Settings01Icon} />
            Receipt settings
          </MenuLinkItem>
        </MenuPopup>
      </Menu>
    </Group>
  );
}
