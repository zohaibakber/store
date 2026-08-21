import { TicketStarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InvitationToken } from "@store/auth";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import * as z from "zod";

import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { useLinkedInvitation, useOrganization } from "@/lib/organization";

const acceptSchema = z.object({
  token: z.string().trim().min(8, "Paste the invitation you were sent."),
});

const redeemable = (pasted: string) => {
  const trimmed = pasted.trim();
  const marker = trimmed.indexOf("invitation=");
  if (marker < 0) return trimmed;
  return decodeURIComponent(trimmed.slice(marker + "invitation=".length).split("&")[0] ?? "");
};

export function AcceptInvitationCard() {
  const { actions } = useOrganization();
  const navigate = useNavigate();
  const linked = useLinkedInvitation();

  const form = useForm({
    defaultValues: { token: linked },
    validators: { onSubmit: acceptSchema },
    onSubmit: async ({ value }) => {
      const result = await actions.organize({
        _tag: "AcceptInvitation",
        token: InvitationToken.make(redeemable(value.token)),
      });
      if (result?._tag !== "Joined") return;
      form.reset({ token: "" });
      toastManager.add({ title: `You joined ${result.organization.name}`, type: "success" });
      await navigate({ to: "/settings/organization", search: {}, replace: true });
    },
  });

  React.useEffect(() => {
    if (linked) form.setFieldValue("token", linked);
  }, [form, linked]);

  return (
    <FrameCard
      description="Accepting switches this device to that store."
      title="Join with an invitation"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Fieldset className="flex w-full flex-col gap-4 sm:flex-row sm:items-end">
          <form.Field
            name="token"
            children={(field) => (
              <div className="min-w-0 flex-1">
                <FormField field={field} label="Invitation">
                  {(control) => (
                    <Input
                      {...control}
                      autoComplete="off"
                      className="font-mono"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Paste the invite link or token"
                      value={field.state.value}
                    />
                  )}
                </FormField>
              </div>
            )}
          />
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button
                className="sm:shrink-0"
                disabled={!canSubmit}
                loading={isSubmitting}
                type="submit"
                variant="outline"
              >
                <HugeiconsIcon aria-hidden="true" icon={TicketStarIcon} />
                Accept
              </Button>
            )}
          </form.Subscribe>
        </Fieldset>
      </form>
    </FrameCard>
  );
}
