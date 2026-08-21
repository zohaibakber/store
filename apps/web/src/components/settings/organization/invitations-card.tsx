import {
  Copy01Icon,
  Mail01Icon,
  MailAdd01Icon,
  MultiplicationSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  EmailAddress,
  type AuthOrganizationMembership,
  type InvitableRole,
  type OrganizationInvitation,
} from "@store/auth";
import { useForm } from "@tanstack/react-form";
import * as React from "react";
import * as z from "zod";

import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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

const inviteSchema = z.object({
  email: z.email("Enter a valid email."),
  role: z.enum(["admin", "member"]),
});

interface InviteDraft {
  email: string;
  role: InvitableRole;
}

const blankInvite: InviteDraft = { email: "", role: "member" };

/**
 * Nothing is mailed yet, so the person who created the invitation is the one
 * who has to deliver it. The secret is readable exactly once, in the response
 * that created it, and it is held here until the card unmounts.
 */
function InviteForm({ organizationId }: { organizationId: AuthOrganizationMembership["id"] }) {
  const { actions } = useOrganization();
  const [issued, setIssued] = React.useState<{ email: string; token: string } | null>(null);

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
      setIssued({ email: result.invitation.email, token: result.token });
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
        <Fieldset className="flex w-full flex-col gap-4 sm:flex-row sm:items-end">
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
        </Fieldset>
      </form>

      {issued ? (
        <Frame className="w-full transition-[opacity,translate] duration-200 starting:translate-y-1 starting:opacity-0">
          <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">Invitation for {issued.email}</p>
              <p className="text-sm text-muted-foreground">
                {invitationHandoff(issued.token).kind === "link"
                  ? "Send them this link yourself. It is shown once."
                  : "Send them this token yourself. It is shown once."}
              </p>
            </div>
            <Button
              className="shrink-0"
              onClick={() => void copyInvitation(issued.token)}
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
      <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
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
      <div className="flex flex-col gap-6">
        <InviteForm organizationId={organization.id} />

        {invitations.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={Mail01Icon} />
              </EmptyMedia>
              <EmptyTitle>Nothing pending</EmptyTitle>
              <EmptyDescription>Invitations you send appear here until redeemed.</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
