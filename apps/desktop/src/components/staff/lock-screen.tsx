import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StaffId, StaffMember } from "@store/contracts";
import {
  causeSurface,
  staffRefusalCopy,
  useCommand,
  type InventoryFailure,
} from "@store/inventory-react";
import { initials } from "@store/services/format";
import type * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";

import {
  isPin,
  newPinProblem,
  ownerFirst,
  PIN_HINT,
  staffRoleLabel,
} from "@/components/staff/access";
import { PinInput, StaffScreen, StaffScreenHeader, useThrottle } from "@/components/staff/screen";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type View =
  | { readonly _tag: "list" }
  | { readonly _tag: "pin"; readonly id: StaffId }
  | { readonly _tag: "recover" };

function useRefusal() {
  const [error, setError] = useState<string | null>(null);
  const throttle = useThrottle();
  const throttled = throttle.remainingMillis > 0;

  const refuse = (cause: Cause.Cause<InventoryFailure>) => {
    const surface = causeSurface(cause);
    if (
      surface._tag === "staff" &&
      surface.reason === "throttled" &&
      surface.retryAfterMillis !== undefined
    ) {
      setError(null);
      throttle.start(surface.retryAfterMillis);
      return;
    }
    setError(surface.message);
  };

  return {
    message: throttled ? staffRefusalCopy("throttled", throttle.remainingMillis) : error,
    throttled,
    refuse,
    clear: () => setError(null),
  };
}

function MemberList({
  focusId,
  members,
  onPick,
}: {
  readonly focusId: StaffId | null;
  readonly members: ReadonlyArray<StaffMember>;
  readonly onPick: (id: StaffId) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const focused = members.some((member) => member.id === focusId) ? focusId : members[0]?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
    const current = buttons.findIndex((button) => button === document.activeElement);
    const focus = (index: number) => {
      event.preventDefault();
      buttons[(index + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return focus(current + 1);
      case "ArrowUp":
        return focus(current - 1);
      case "Home":
        return focus(0);
      case "End":
        return focus(buttons.length - 1);
    }
    if (event.key.length !== 1 || event.key === " ") return;
    const letter = event.key.toLowerCase();
    const order = members.map((_, index) => (current + 1 + index) % members.length);
    const match = order.find((index) => members[index]?.name.toLowerCase().startsWith(letter));
    if (match !== undefined) focus(match);
  };

  return (
    <ul aria-label="Staff" className="flex flex-col gap-1" onKeyDown={onKeyDown} ref={list}>
      {members.map((member) => (
        <li key={member.id}>
          <Button
            autoFocus={member.id === focused}
            className="w-full justify-start"
            data-testid="lock-member"
            onClick={() => onPick(member.id)}
            size="lg"
            type="button"
            variant="outline"
          >
            <span className="min-w-0 flex-1 truncate text-start">{member.name}</span>
            <span className="text-xs text-muted-foreground">{staffRoleLabel(member.role)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function PinEntry({
  member,
  onBack,
}: {
  readonly member: StaffMember;
  readonly onBack: (() => void) | null;
}) {
  const [unlock] = useCommand((commands) => commands.staff.unlock);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const refusal = useRefusal();
  const input = useRef<HTMLInputElement>(null);
  const blocked = busy || refusal.throttled;

  useEffect(() => {
    if (!blocked) input.current?.focus();
  }, [blocked]);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked || !isPin(pin)) return;
    const entered = pin;
    setPin("");
    setBusy(true);
    refusal.clear();
    const exit = await unlock({ staffId: member.id, pin: Redacted.make(entered) });
    if (Exit.isFailure(exit)) refusal.refuse(exit.cause);
    setBusy(false);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || onBack === null) return;
        event.preventDefault();
        onBack();
      }}
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar className="size-12">
          <AvatarFallback>{initials(member.name)}</AvatarFallback>
        </Avatar>
        <h1 className="max-w-full truncate text-lg font-medium" data-testid="lock-selected-member">
          {member.name}
        </h1>
        <p className="text-xs text-muted-foreground">{staffRoleLabel(member.role)}</p>
      </div>
      <Field invalid={refusal.message !== null}>
        <FieldLabel htmlFor="lock-pin">PIN</FieldLabel>
        <PinInput
          aria-invalid={refusal.message !== null}
          disabled={blocked}
          id="lock-pin"
          name="pin"
          onValueChange={setPin}
          ref={input}
          value={pin}
        />
        {refusal.message !== null ? (
          <FieldError data-testid="lock-error" match>
            {refusal.message}
          </FieldError>
        ) : null}
      </Field>
      <div className="flex flex-col gap-2">
        <Button className="w-full" disabled={refusal.throttled} loading={busy} type="submit">
          Unlock
        </Button>
        {onBack ? (
          <Button className="w-full" onClick={onBack} type="button" variant="ghost">
            <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
            Someone else
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function OwnerRecovery({
  onBack,
  onRecovered,
}: {
  readonly onBack: () => void;
  readonly onRecovered: (recoveryCode: string) => void;
}) {
  const [recoverOwner] = useCommand((commands) => commands.staff.recoverOwner);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusal();
  const blocked = busy || refusal.throttled;

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked || code.trim() === "") return;
    const problem = newPinProblem(pin, again);
    setPinError(problem);
    if (problem !== null) return;
    setBusy(true);
    refusal.clear();
    const exit = await recoverOwner({
      recoveryCode: Redacted.make(code.trim()),
      pin: Redacted.make(pin),
    });
    if (Exit.isFailure(exit)) {
      refusal.refuse(exit.cause);
      setBusy(false);
      return;
    }
    onRecovered(exit.value.recoveryCode);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onBack();
      }}
      onSubmit={(event) => void submit(event)}
    >
      <StaffScreenHeader
        description="Enter the recovery code you wrote down when staff PINs were turned on, then choose a new owner PIN."
        title="Reset the owner PIN"
      />
      <Field invalid={refusal.message !== null}>
        <FieldLabel htmlFor="recover-code">Recovery code</FieldLabel>
        <Input
          aria-invalid={refusal.message !== null}
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          disabled={blocked}
          id="recover-code"
          name="recoveryCode"
          onChange={(event) => setCode(event.currentTarget.value)}
          spellCheck={false}
          type="text"
          value={code}
        />
        {refusal.message !== null ? (
          <FieldError data-testid="recover-error" match>
            {refusal.message}
          </FieldError>
        ) : null}
      </Field>
      <Field invalid={pinError !== null}>
        <FieldLabel htmlFor="recover-pin">New owner PIN</FieldLabel>
        <PinInput
          aria-invalid={pinError !== null}
          disabled={blocked}
          id="recover-pin"
          name="pin"
          onValueChange={setPin}
          value={pin}
        />
        <FieldDescription>{PIN_HINT}</FieldDescription>
      </Field>
      <Field invalid={pinError !== null}>
        <FieldLabel htmlFor="recover-pin-again">New owner PIN again</FieldLabel>
        <PinInput
          aria-invalid={pinError !== null}
          disabled={blocked}
          id="recover-pin-again"
          name="pinAgain"
          onValueChange={setAgain}
          value={again}
        />
        {pinError !== null ? <FieldError match>{pinError}</FieldError> : null}
      </Field>
      <div className="flex flex-col gap-2">
        <Button className="w-full" disabled={refusal.throttled} loading={busy} type="submit">
          Reset owner PIN
        </Button>
        <Button className="w-full" onClick={onBack} type="button" variant="ghost">
          <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
          Back
        </Button>
      </div>
    </form>
  );
}

export function LockScreen({
  lastActorId,
  onRecovered,
  staff,
}: {
  readonly lastActorId: StaffId | null;
  readonly onRecovered: (recoveryCode: string) => void;
  readonly staff: ReadonlyArray<StaffMember>;
}) {
  const members = ownerFirst(staff);
  const only = members.length === 1 ? members[0] : undefined;
  const [view, setView] = useState<View>({ _tag: "list" });
  const picked = view._tag === "pin" ? members.find((member) => member.id === view.id) : undefined;
  const selected = view._tag === "recover" ? undefined : (only ?? picked);
  const toList = () => setView({ _tag: "list" });

  return (
    <StaffScreen>
      {view._tag === "recover" ? (
        <OwnerRecovery onBack={toList} onRecovered={onRecovered} />
      ) : (
        <>
          {selected ? (
            <PinEntry key={selected.id} member={selected} onBack={only ? null : toList} />
          ) : (
            <div className="flex flex-col gap-6">
              <StaffScreenHeader
                description="Pick your name, then type your PIN."
                title="Who is using the app?"
              />
              <MemberList
                focusId={lastActorId}
                members={members}
                onPick={(id) => setView({ _tag: "pin", id })}
              />
            </div>
          )}
          <Button
            className="self-center"
            onClick={() => setView({ _tag: "recover" })}
            size="sm"
            type="button"
            variant="link"
          >
            Forgot owner PIN
          </Button>
        </>
      )}
    </StaffScreen>
  );
}
