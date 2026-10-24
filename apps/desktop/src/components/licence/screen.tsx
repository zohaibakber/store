import { ENTER_LICENCE, LICENCE_HOW_TO_GET } from "@/components/licence/copy";
import { LicenceFields, useLicenceEntry } from "@/components/licence/entry";
import { StaffScreen, StaffScreenHeader } from "@/components/staff/screen";
import { Button } from "@/components/ui/button";

export function LicenceScreen() {
  const entry = useLicenceEntry();

  return (
    <StaffScreen>
      <form className="flex flex-col gap-6" data-testid="licence-screen" onSubmit={entry.onSubmit}>
        <StaffScreenHeader
          description="Paste the licence you were sent, or open the licence file. You do this once a year."
          title="Enter your licence"
        />
        <LicenceFields entry={entry} />
        <Button className="w-full" disabled={!entry.canSubmit} loading={entry.busy} type="submit">
          {ENTER_LICENCE}
        </Button>
        <p className="text-center text-xs text-muted-foreground" data-testid="licence-how-to-get">
          {LICENCE_HOW_TO_GET}
        </p>
      </form>
    </StaffScreen>
  );
}
