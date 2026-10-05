import { ENTER_LICENCE, ENTER_NEW_LICENCE } from "@/components/licence/copy";
import { LicenceFields, useLicenceEntry } from "@/components/licence/entry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";

export function LicenceDialog({ onClose }: { readonly onClose: () => void }) {
  const entry = useLicenceEntry(onClose);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup data-testid="licence-dialog">
        <DialogHeader>
          <DialogTitle>{ENTER_NEW_LICENCE}</DialogTitle>
          <DialogDescription>
            Paste the new licence, or open the licence file. Your shop's data stays as it is.
          </DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={entry.onSubmit}>
          <DialogPanel>
            <LicenceFields entry={entry} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={!entry.canSubmit} loading={entry.busy} type="submit">
              {ENTER_LICENCE}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
