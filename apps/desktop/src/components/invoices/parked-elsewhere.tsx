import { UserMultipleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InvoiceId } from "@store/contracts/ids";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import type { ParkedElsewhere } from "@/hooks/use-sale-drafts";
import { formatCount } from "@/lib/format";
import { saleDraftLabel, type SaleDraftMember } from "@/lib/sale-drafts";

const summary = (parked: ReadonlyArray<ParkedElsewhere>) => {
  const [only] = parked;
  const sales = formatCount(
    parked.reduce((count, held) => count + held.drafts.length, 0),
    "sale",
  );
  return parked.length === 1 && only
    ? `${only.owner.member.name}: ${sales}`
    : `Other staff: ${sales}`;
};

function ParkedElsewhereMenu({
  parked,
  takeOver,
}: {
  readonly parked: ReadonlyArray<ParkedElsewhere>;
  readonly takeOver: (from: SaleDraftMember, id: InvoiceId) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [taking, setTaking] = useState<InvoiceId | null>(null);

  const take = async (from: SaleDraftMember, id: InvoiceId) => {
    setTaking(id);
    try {
      if (await takeOver(from, id)) setOpen(false);
    } finally {
      setTaking(null);
    }
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Button size="sm" type="button" variant="outline" />}>
        <HugeiconsIcon aria-hidden="true" icon={UserMultipleIcon} />
        <span className="max-w-48 truncate">{summary(parked)}</span>
      </PopoverTrigger>
      <PopoverPopup align="end" aria-label="Sales parked by other staff" className="w-80">
        <div className="flex flex-col gap-4">
          {parked.map(({ owner, drafts }) => (
            <section className="flex flex-col gap-2" key={owner.member.id}>
              <h3 className="truncate text-xs text-muted-foreground">{owner.member.name}</h3>
              <ul className="flex flex-col gap-2">
                {drafts.map((draft) => (
                  <li className="flex items-center justify-between gap-3" key={draft.id}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{saleDraftLabel(draft)}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatCount(draft.lines.length, "line")}
                      </span>
                    </span>
                    <Button
                      disabled={taking !== null}
                      onClick={() => void take(owner, draft.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Take over
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export { ParkedElsewhereMenu };
