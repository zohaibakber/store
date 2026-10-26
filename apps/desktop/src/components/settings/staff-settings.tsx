import { Delete02Icon, PencilEdit02Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  MAX_AUTO_LOCK_MINUTES,
  MAX_STAFF_NAME_LENGTH,
  type AssignableStaffRole,
  type StaffEvent,
  type StaffMember,
} from "@store/contracts";
import { causeSurface, useCommand } from "@store/inventory-react";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";

import { FrameCard } from "@/components/shared/frame-card";
import {
  nameProblem,
  newPinProblem,
  ownerFirst,
  PIN_HINT,
  staffRoleLabel,
  useStaffAccess,
} from "@/components/staff/access";
import { PinInput, RecoveryCode, WRITTEN_DOWN } from "@/components/staff/screen";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { useReleaseSaleDrafts } from "@/hooks/use-sale-drafts";
import { toastFailure } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { formatInvoiceTime } from "@/lib/format-date";

function FormError({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <Alert data-testid="staff-form-error" variant="error">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function NameField({
  id,
  onChange,
  value,
}: {
  readonly id: string;
  readonly onChange: (name: string) => void;
  readonly value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Name</FieldLabel>
      <Input
        autoComplete="off"
        autoFocus
        id={id}
        maxLength={MAX_STAFF_NAME_LENGTH}
        name="name"
        onChange={(event) => onChange(event.currentTarget.value)}
        type="text"
        value={value}
      />
    </Field>
  );
}

function PinPairFields({
  again,
  idPrefix,
  label,
  onAgainChange,
  onPinChange,
  optional = false,
  pin,
}: {
  readonly again: string;
  readonly idPrefix: string;
  readonly label: string;
  readonly onAgainChange: (pin: string) => void;
  readonly onPinChange: (pin: string) => void;
  readonly optional?: boolean;
  readonly pin: string;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-pin`}>{label}</FieldLabel>
        <PinInput id={`${idPrefix}-pin`} name="pin" onValueChange={onPinChange} value={pin} />
        <FieldDescription>
          {optional ? `Leave empty to keep the current PIN. ${PIN_HINT}` : PIN_HINT}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-pin-again`}>{label} again</FieldLabel>
        <PinInput
          id={`${idPrefix}-pin-again`}
          name="pinAgain"
          onValueChange={onAgainChange}
          value={again}
        />
      </Field>
    </>
  );
}

function OwnerSetupDialog({
  onDone,
  onOpenChange,
}: {
  readonly onDone: (recoveryCode: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [setUpOwner] = useCommand((commands) => commands.staff.setUpOwner);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = nameProblem(name) ?? newPinProblem(pin, again);
    setError(problem);
    if (problem !== null || busy) return;
    setBusy(true);
    const exit = await setUpOwner({ name: name.trim(), pin: Redacted.make(pin) });
    if (Exit.isFailure(exit)) {
      setError(causeSurface(exit.cause).message);
      setBusy(false);
      return;
    }
    onDone(exit.value.recoveryCode);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Turn on staff PINs</DialogTitle>
          <DialogDescription>
            You become the owner. The app will ask for a PIN when it starts and after it has been
            left idle.
          </DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <FormError message={error} />
              <NameField id="owner-name" onChange={setName} value={name} />
              <PinPairFields
                again={again}
                idPrefix="owner"
                label="PIN"
                onAgainChange={setAgain}
                onPinChange={setPin}
                pin={pin}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button loading={busy} type="submit">
              Turn on
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

function SoloCard({ onRecoveryCode }: { readonly onRecoveryCode: (code: string) => void }) {
  const [settingUp, setSettingUp] = useState(false);
  return (
    <FrameCard title="Staff">
      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="min-w-0 text-muted-foreground">
          You are working alone. Turn on staff PINs when someone else starts using this computer, or
          to lock the app when you step away.
        </p>
        <Button className="shrink-0" onClick={() => setSettingUp(true)} size="sm" type="button">
          Turn on staff PINs
        </Button>
      </div>
      {settingUp ? <OwnerSetupDialog onDone={onRecoveryCode} onOpenChange={setSettingUp} /> : null}
    </FrameCard>
  );
}

type MemberEdit =
  | { readonly _tag: "add" }
  | { readonly _tag: "edit"; readonly member: StaffMember };

const ASSIGNABLE_ROLES = [
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager" },
] as const satisfies ReadonlyArray<{ readonly value: AssignableStaffRole; readonly label: string }>;

function MemberDialog({
  edit,
  onClose,
  onSaved,
}: {
  readonly edit: MemberEdit;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [add] = useCommand((commands) => commands.staff.add);
  const [update] = useCommand((commands) => commands.staff.update);
  const member = edit._tag === "edit" ? edit.member : null;
  const isOwner = member?.role === "owner";
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState<AssignableStaffRole>(
    member === null || member.role === "owner" ? "cashier" : member.role,
  );
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keepsPin = member !== null && pin === "" && again === "";

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = nameProblem(name) ?? (keepsPin ? null : newPinProblem(pin, again));
    setError(problem);
    if (problem !== null || busy) return;
    setBusy(true);
    const save = () => {
      if (member === null) return add({ name: name.trim(), role, pin: Redacted.make(pin) });
      const change = { id: member.id, name: name.trim(), role: isOwner ? member.role : role };
      return update(keepsPin ? change : { ...change, pin: Redacted.make(pin) });
    };
    const exit = await save();
    if (Exit.isFailure(exit)) {
      setError(causeSurface(exit.cause).message);
      setBusy(false);
      return;
    }
    toastManager.add({
      title: member === null ? `${exit.value.name} added` : `${exit.value.name} updated`,
      type: "success",
    });
    onSaved();
    onClose();
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{member === null ? "Add staff" : `Edit ${member.name}`}</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={(event) => void submit(event)}>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <FormError message={error} />
              <NameField id="staff-name" onChange={setName} value={name} />
              {isOwner ? null : (
                <Field>
                  <FieldLabel htmlFor="staff-role">Role</FieldLabel>
                  <Select
                    items={ASSIGNABLE_ROLES}
                    name="role"
                    onValueChange={(value) => {
                      if (value !== null) setRole(value);
                    }}
                    value={role}
                  >
                    <SelectTrigger id="staff-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ASSIGNABLE_ROLES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    A cashier sells. A manager also manages stock and sees reports.
                  </FieldDescription>
                </Field>
              )}
              <PinPairFields
                again={again}
                idPrefix="staff"
                label={member === null ? "PIN" : "New PIN"}
                onAgainChange={setAgain}
                onPinChange={setPin}
                optional={member !== null}
                pin={pin}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button loading={busy} type="submit">
              {member === null ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

function Confirm({
  action,
  children,
  destructive = false,
  onConfirm,
  onOpenChange,
  open,
  title,
}: {
  readonly action: string;
  readonly children: ReactNode;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title: string;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            onClick={onConfirm}
            render={<Button type="button" variant={destructive ? "destructive" : "default"} />}
          >
            {action}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RosterCard({
  onChanged,
  staff,
}: {
  readonly onChanged: () => void;
  readonly staff: ReadonlyArray<StaffMember>;
}) {
  const [remove] = useCommand((commands) => commands.staff.remove);
  const [edit, setEdit] = useState<MemberEdit | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const removeMember = async (member: StaffMember) => {
    const exit = await remove(member.id);
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
      return;
    }
    toastManager.add({ title: `${member.name} removed`, type: "success" });
    onChanged();
  };

  return (
    <FrameCard
      action={
        <Button onClick={() => setEdit({ _tag: "add" })} size="sm" type="button">
          <HugeiconsIcon aria-hidden="true" icon={UserAdd01Icon} />
          Add staff
        </Button>
      }
      description={`${staff.length} on this computer`}
      title="Staff"
    >
      <ul className="flex flex-col divide-y text-sm" data-testid="staff-roster">
        {ownerFirst(staff).map((member) => (
          <li
            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            data-testid="staff-row"
            key={member.id}
          >
            <span className="min-w-0 flex-1 truncate font-medium" title={member.name}>
              {member.name}
            </span>
            <Badge variant={member.role === "owner" ? "secondary" : "outline"}>
              {staffRoleLabel(member.role)}
            </Badge>
            <Button
              aria-label={`Edit ${member.name}`}
              onClick={() => setEdit({ _tag: "edit", member })}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
            </Button>
            <Button
              aria-label={`Remove ${member.name}`}
              disabled={member.role === "owner"}
              onClick={() => {
                setRemoving(member);
                setRemoveOpen(true);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
            </Button>
          </li>
        ))}
      </ul>
      {edit ? (
        <MemberDialog
          edit={edit}
          key={edit._tag === "edit" ? edit.member.id : "add"}
          onClose={() => setEdit(null)}
          onSaved={onChanged}
        />
      ) : null}
      <Confirm
        action="Remove"
        destructive
        onConfirm={() => {
          if (removing) void removeMember(removing);
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title={removing ? `Remove ${removing.name}?` : "Remove staff member?"}
      >
        They will no longer be able to unlock the app. Sales they made keep their name.
      </Confirm>
    </FrameCard>
  );
}

function AutoLockRow({
  minutes,
  onChanged,
}: {
  readonly minutes: number;
  readonly onChanged: () => void;
}) {
  const [setAutoLock] = useCommand((commands) => commands.staff.setAutoLock);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? String(minutes);
  const next = /^\d+$/u.test(shown) ? Number(shown) : Number.NaN;
  const valid = Number.isInteger(next) && next >= 1 && next <= MAX_AUTO_LOCK_MINUTES;

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || next === minutes) return;
    setBusy(true);
    const exit = await setAutoLock(next);
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
    } else {
      setDraft(null);
      toastManager.add({ title: `The app locks after ${next} idle minutes`, type: "success" });
      onChanged();
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center justify-between gap-4 pb-3">
      <div className="min-w-0">
        <dt>
          <label htmlFor="staff-auto-lock">Lock when idle</label>
        </dt>
        <dd className="text-xs text-muted-foreground">
          Minutes without mouse or keyboard before the app asks for a PIN. From 1 to{" "}
          {MAX_AUTO_LOCK_MINUTES}, normally {DEFAULT_AUTO_LOCK_MINUTES}.
        </dd>
      </div>
      <form className="flex shrink-0 items-center gap-2" onSubmit={(event) => void save(event)}>
        <Input
          aria-invalid={!valid}
          className="w-20"
          id="staff-auto-lock"
          inputMode="numeric"
          max={MAX_AUTO_LOCK_MINUTES}
          min={1}
          name="minutes"
          onChange={(event) => setDraft(event.currentTarget.value)}
          size="sm"
          type="number"
          value={shown}
        />
        <Button
          disabled={!valid || next === minutes}
          loading={busy}
          size="sm"
          type="submit"
          variant="outline"
        >
          Save
        </Button>
      </form>
    </div>
  );
}

function AccessCard({
  minutes,
  onChanged,
  onRecoveryCode,
}: {
  readonly minutes: number;
  readonly onChanged: () => void;
  readonly onRecoveryCode: (code: string) => void;
}) {
  const [renewRecoveryCode] = useCommand((commands) => commands.staff.renewRecoveryCode);
  const [turnOff] = useCommand((commands) => commands.staff.turnOff);
  const releaseSaleDrafts = useReleaseSaleDrafts();
  const [renewing, setRenewing] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [busy, setBusy] = useState<"idle" | "renew" | "turnOff">("idle");

  const renew = async () => {
    setBusy("renew");
    const exit = await renewRecoveryCode();
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
    } else {
      onRecoveryCode(exit.value.recoveryCode);
      onChanged();
    }
    setBusy("idle");
  };

  const stop = async () => {
    setBusy("turnOff");
    const exit = await turnOff();
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
    } else {
      const dropped = releaseSaleDrafts();
      toastManager.add({
        title: "Staff PINs are off",
        description:
          dropped > 0
            ? `${formatCount(dropped, "parked sale")} did not fit and ${dropped === 1 ? "was" : "were"} discarded.`
            : undefined,
        type: dropped > 0 ? "warning" : "success",
      });
    }
    setBusy("idle");
  };

  return (
    <FrameCard title="Locking and recovery">
      <dl className="flex flex-col divide-y text-sm">
        <AutoLockRow minutes={minutes} onChanged={onChanged} />
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <dt>Recovery code</dt>
            <dd className="text-xs text-muted-foreground">
              The only way back in if the owner PIN is forgotten. Making a new one stops the old one
              working.
            </dd>
          </div>
          <Button
            className="shrink-0"
            disabled={busy !== "idle"}
            loading={busy === "renew"}
            onClick={() => setRenewing(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            New recovery code
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 pt-3">
          <div className="min-w-0">
            <dt>Work alone</dt>
            <dd className="text-xs text-muted-foreground">
              Removes every staff member and stops the app locking.
            </dd>
          </div>
          <Button
            className="shrink-0"
            disabled={busy !== "idle"}
            loading={busy === "turnOff"}
            onClick={() => setTurningOff(true)}
            size="sm"
            type="button"
            variant="destructive-outline"
          >
            Turn off staff PINs
          </Button>
        </div>
      </dl>
      <Confirm
        action="Make a new code"
        onConfirm={() => void renew()}
        onOpenChange={setRenewing}
        open={renewing}
        title="Make a new recovery code?"
      >
        The code you wrote down before stops working. The new code is shown once.
      </Confirm>
      <Confirm
        action="Turn off"
        destructive
        onConfirm={() => void stop()}
        onOpenChange={setTurningOff}
        open={turningOff}
        title="Turn off staff PINs?"
      >
        Every staff member is removed, including you as owner, and the app will no longer lock.
        Sales your staff have parked stay open on New Sale.
      </Confirm>
    </FrameCard>
  );
}

const eventSentence = ({ actor, kind, subject }: StaffEvent): string => {
  const who = actor ?? "Someone";
  const whom = subject ?? "a staff member";
  switch (kind) {
    case "ownerSetUp":
      return `${who} turned on staff PINs and became the owner`;
    case "staffAdded":
      return `${who} added ${whom}`;
    case "staffUpdated":
      return `${who} changed the details of ${whom}`;
    case "pinChanged":
      return actor !== null && actor === subject
        ? `${who} changed their own PIN`
        : `${who} changed the PIN of ${whom}`;
    case "staffRemoved":
      return `${who} removed ${whom}`;
    case "ownerRecovered":
      return "The owner PIN was reset with the recovery code";
    case "recoveryCodeRenewed":
      return `${who} made a new recovery code`;
    case "autoLockChanged":
      return `${who} changed the idle lock time`;
    case "draftHandedOver":
      return `${who} took over a parked sale from ${whom}`;
    case "unlockThrottled":
      return `Too many wrong PIN attempts for ${whom}`;
    case "staffTurnedOff":
      return `${who} turned off staff PINs`;
  }
};

const newestFirst = (events: ReadonlyArray<StaffEvent>): ReadonlyArray<StaffEvent> =>
  Array.from(events).sort((a, b) => b.at - a.at || b.id - a.id);

type Activity =
  | { readonly _tag: "loading" }
  | { readonly _tag: "loaded"; readonly events: ReadonlyArray<StaffEvent> }
  | { readonly _tag: "failed"; readonly message: string };

function ActivityCard({ version }: { readonly version: number }) {
  const [events] = useCommand((commands) => commands.staff.events);
  const [activity, setActivity] = useState<Activity>({ _tag: "loading" });

  useEffect(() => {
    let current = true;
    void events().then((exit) => {
      if (!current) return;
      setActivity(
        Exit.isSuccess(exit)
          ? { _tag: "loaded", events: exit.value }
          : { _tag: "failed", message: causeSurface(exit.cause).message },
      );
    });
    return () => {
      current = false;
    };
  }, [events, version]);

  return (
    <FrameCard title="Recent activity">
      {activity._tag === "failed" ? (
        <p className="text-sm text-destructive-foreground">{activity.message}</p>
      ) : activity._tag === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : activity.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm" data-testid="staff-activity">
          {newestFirst(activity.events).map((event) => (
            <li className="flex items-baseline justify-between gap-4" key={event.id}>
              <span className="min-w-0">{eventSentence(event)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatInvoiceTime(event.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FrameCard>
  );
}

function RecoveryCodeDialog({
  code,
  onWrittenDown,
}: {
  readonly code: string | null;
  readonly onWrittenDown: () => void;
}) {
  return (
    <AlertDialog open={code !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Write down your recovery code</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="px-6 pb-6">{code === null ? null : <RecoveryCode code={code} />}</div>
        <AlertDialogFooter>
          <Button onClick={onWrittenDown} type="button">
            {WRITTEN_DOWN}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function StaffSettings() {
  const staff = useStaffAccess();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((current) => current + 1);

  return (
    <>
      {staff._tag === "solo" ? <SoloCard onRecoveryCode={setRecoveryCode} /> : null}
      {staff._tag === "unlocked" && staff.actor.role === "owner" ? (
        <>
          <RosterCard onChanged={changed} staff={staff.staff} />
          <AccessCard
            minutes={staff.autoLockMinutes}
            onChanged={changed}
            onRecoveryCode={setRecoveryCode}
          />
          <ActivityCard version={version} />
        </>
      ) : null}
      <RecoveryCodeDialog code={recoveryCode} onWrittenDown={() => setRecoveryCode(null)} />
    </>
  );
}
