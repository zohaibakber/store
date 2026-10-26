import { FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MAX_LICENCE_TEXT_LENGTH, type Licence } from "@store/contracts";
import { causeSurface, licenceRefusalCopy, useEnterLicence } from "@store/inventory-react";
import * as Exit from "effect/Exit";
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type SubmitEvent } from "react";

import { OPEN_LICENCE_FILE } from "@/components/licence/copy";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-date";

const MAX_LICENCE_FILE_BYTES = MAX_LICENCE_TEXT_LENGTH * 4;

export const licenceTextOf = (raw: string): string =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("");

const announce = (licence: Licence) =>
  toastManager.add({
    title: `${licence.shopName} is licensed until ${formatDate(licence.expiresAt)}`,
    type: "success",
  });

export type LicenceEntry = {
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly error: string | null;
  readonly onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly setText: (text: string) => void;
  readonly text: string;
};

export function useLicenceEntry(onAccepted?: (licence: Licence) => void): LicenceEntry {
  const enterLicence = useEnterLicence();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async (raw: string) => {
    if (busy) return;
    const licenceText = licenceTextOf(raw);
    if (licenceText === "" || licenceText.length > MAX_LICENCE_TEXT_LENGTH) {
      setError(licenceRefusalCopy("malformed"));
      return;
    }
    setBusy(true);
    setError(null);
    const exit = await enterLicence(licenceText);
    if (Exit.isFailure(exit)) {
      setError(causeSurface(exit.cause).message);
    } else {
      setText("");
      announce(exit.value);
      onAccepted?.(exit.value);
    }
    setBusy(false);
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_LICENCE_FILE_BYTES) {
      setError(licenceRefusalCopy("malformed"));
      return;
    }
    try {
      const contents = await file.text();
      setText(licenceTextOf(contents));
      await enter(contents);
    } catch {
      setError("That file could not be read. Paste the licence instead.");
    }
  };

  return {
    busy,
    canSubmit: text.trim() !== "",
    error,
    onFile: (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void readFile(file);
    },
    onSubmit: (event) => {
      event.preventDefault();
      void enter(text);
    },
    setText: (next) => {
      setText(next);
      setError(null);
    },
    text,
  };
}

const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
};

export function LicenceFields({ entry }: { readonly entry: LicenceEntry }) {
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <Field invalid={entry.error !== null}>
        <FieldLabel htmlFor="licence-text">Licence</FieldLabel>
        <Textarea
          aria-invalid={entry.error !== null}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          autoFocus
          disabled={entry.busy}
          id="licence-text"
          name="licence"
          onChange={(event) => entry.setText(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder="Paste the licence here"
          spellCheck={false}
          value={entry.text}
        />
        {entry.error !== null ? (
          <FieldError data-testid="licence-error" match>
            {entry.error}
          </FieldError>
        ) : null}
      </Field>
      <input
        aria-label="Licence file"
        data-testid="licence-file"
        hidden
        id="licence-file"
        name="licenceFile"
        onChange={entry.onFile}
        ref={file}
        type="file"
      />
      <Button
        className="self-start"
        disabled={entry.busy}
        onClick={() => file.current?.click()}
        size="sm"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon aria-hidden="true" icon={FileAttachmentIcon} />
        {OPEN_LICENCE_FILE}
      </Button>
    </div>
  );
}
