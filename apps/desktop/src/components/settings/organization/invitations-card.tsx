import { Copy01Icon, MailAdd01Icon, MultiplicationSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  EmailAddress,
  type AuthOrganizationMembership,
  type InvitableRole,
  type OrganizationInvitation,
} from "@store/auth";
import { useForm } from "@tanstack/react-form";
import * as Schema from "effect/Schema";
import * as React from "react";

import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fieldset } from "@/components/ui/fieldset";
import { Frame, FrameHeader } from "@/components/ui/frame";
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
import { copyInvitation, invitationHandoff, useOrganization } from "@/lib/organization";

const invitableRoles = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

const inviteSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    email: Schema.String.check(
      Schema.isMinLength(3, { message: "Enter a valid email." }),
      Schema.isMaxLength(320),
      Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u, { message: "Enter a valid email." }),
    ),
    role: Schema.Literals(["admin", "member"]),
  }),
);

interface InviteDraft {
  email: string;
  role: InvitableRole;
}

const blankInvite: InviteDraft = { email: "", role: "member" };

function InviteForm({ organizationId }: { organizationId: AuthOrganizationMembership["id"] }) {
  const { actions } = useOrganization();
  const [handoff, setHandoff] = React.useState<{ email: string; token: string } | null>(null);

  const form = useForm({
    defaultValues: blankInvite,
    validators: { onSubmit: inviteSchema },
    onSubmit: async ({ value }) => {
      const result = await actions.organize({
        _tag: "InviteMember",
        organizationId,
        email: EmailAddress.make(value.email.trim().toLowerCase()),
        role: value.role,
      });
      if (result?._tag !== "Invited") return;
      setHandoff({ email: result.invitation.email, token: result.token });
      form.reset();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Fieldset className="w-full">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <form.Field
              name="email"
              children={(field) => (
                <div className="min-w-0 flex-1">
                  <FormField field={field} label="Email">
                    {(control) => (
                      <Input
                        {...control}
                        autoComplete="off"
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder="name@example.com"
                        type="email"
                        value={field.state.value}
                      />
                    )}
                  </FormField>
                </div>
              )}
            />
            <form.Field
              name="role"
              children={(field) => (
                <FormField field={field} label="Role">
                  {(control) => (
                    <Select
                      items={invitableRoles}
                      onValueChange={(role) => role && field.handleChange(role)}
                      value={field.state.value}
                    >
                      <SelectTrigger className="w-full sm:w-32" id={control.id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {invitableRoles.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
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
                  <HugeiconsIcon aria-hidden="true" icon={MailAdd01Icon} />
                  Invite
                </Button>
              )}
            </form.Subscribe>
          </div>
        </Fieldset>
      </form>

      {handoff ? (
        <Frame className="w-full">
          <FrameHeader className="flex-row items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">Invitation for {handoff.email}</p>
              <p className="text-sm text-muted-foreground">
                {invitationHandoff(handoff.token).kind === "link"
                  ? "Send them this link yourself. You'll only see it once."
                  : "Send them this token yourself. You'll only see it once."}
              </p>
            </div>
            <Button
              className="shrink-0"
              onClick={() => void copyInvitation(handoff.token)}
              size="sm"
              variant="outline"
            >
              <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
              Copy invite
            </Button>
          </FrameHeader>
        </Frame>
      ) : null}
    </div>
  );
}

function PendingInvitation({
  invitation,
  organizationId,
}: {
  invitation: OrganizationInvitation;
  organizationId: AuthOrganizationMembership["id"];
}) {
  const { actions } = useOrganization();

  const revoke = async () => {
    const result = await actions.organize({
      _tag: "RevokeInvitation",
      organizationId,
      invitationId: invitation.id,
    });
    if (result) toastManager.add({ title: "Invitation revoked", type: "success" });
  };

  return (
    <Frame className="w-full">
      <FrameHeader className="flex-row items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{invitation.email}</p>
          <p className="text-sm text-muted-foreground">
            Expires {new Date(invitation.expiresAt).toLocaleDateString()}
          </p>
        </div>
        <Badge variant="outline">{invitation.role}</Badge>
        <Button
          aria-label={`Revoke the invitation for ${invitation.email}`}
          onClick={() => void revoke()}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden="true" icon={MultiplicationSignIcon} />
        </Button>
      </FrameHeader>
    </Frame>
  );
}

export function OrganizationInvitationsCard({
  invitations,
  organization,
}: {
  invitations: ReadonlyArray<OrganizationInvitation>;
  organization: AuthOrganizationMembership;
}) {
  return (
    <FrameCard
      description="Invite someone to this store. Delivery is on you for now."
      title="Invitations"
    >
      <div className="flex flex-col gap-4">
        <InviteForm organizationId={organization.id} />

        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pending invitations. Sent invitations stay here until they're redeemed.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {invitations.map((invitation) => (
              <PendingInvitation
                invitation={invitation}
                key={invitation.id}
                organizationId={organization.id}
              />
            ))}
          </div>
        )}
      </div>
    </FrameCard>
  );
}
