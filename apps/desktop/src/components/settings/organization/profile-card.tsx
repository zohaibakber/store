import { OrganizationId, OrganizationName } from "@store/auth";
import type { AuthenticatedWorkspaceSnapshot } from "@store/contracts";
import { useForm } from "@tanstack/react-form";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { runShell } from "@/host/shell";
import { toastBridgeFailure } from "@/lib/errors";

const profileSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isMinLength(2, { message: "Give the store a name." }),
      Schema.isMaxLength(60),
    ),
  }),
);

export function OrganizationProfileCard({
  organization,
  editable,
}: {
  organization: NonNullable<AuthenticatedWorkspaceSnapshot["activeOrganization"]>;
  editable: boolean;
}) {
  const defaults = { name: organization.name };

  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      try {
        await runShell((client) =>
          client
            .AuthUpdateOrganization({
              input: {
                organizationId: OrganizationId.make(organization.id),
                name: OrganizationName.make(value.name.trim()),
              },
            })
            .pipe(Effect.andThen(client.AuthRenew())),
        );
        toastManager.add({ title: "Organization updated", type: "success" });
      } catch (cause) {
        toastBridgeFailure(cause);
      }
    },
  });

  if (!editable) {
    return (
      <FrameCard
        action={<Badge variant="secondary">{organization.role}</Badge>}
        title="Organization"
      >
        <p className="truncate text-sm font-medium">{organization.name}</p>
        <p className="text-sm text-muted-foreground">
          Only an owner or admin can change these details.
        </p>
      </FrameCard>
    );
  }

  return (
    <FrameCard action={<Badge variant="secondary">{organization.role}</Badge>} title="Organization">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Fieldset className="w-full">
          <div className="grid gap-4">
            <form.Field
              name="name"
              children={(field) => (
                <FormField field={field} label="Name">
                  {(control) => (
                    <Input
                      {...control}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="e.g. Ali's Pharmacy"
                      value={field.state.value}
                    />
                  )}
                </FormField>
              )}
            />
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <div className="flex justify-end">
                  <Button disabled={!canSubmit} loading={isSubmitting} size="sm" type="submit">
                    Save changes
                  </Button>
                </div>
              )}
            </form.Subscribe>
          </div>
        </Fieldset>
      </form>
    </FrameCard>
  );
}
