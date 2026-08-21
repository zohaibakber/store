import { UserRemove01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AuthOrganizationMembership, OrganizationMember, OrganizationRole } from "@store/auth";

import { FrameCard } from "@/components/shared/frame-card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { initials } from "@/lib/format";
import { useOrganization } from "@/lib/organization";

const roles = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

/** An admin manages the people below them; owners and admins are the owner's business. */
const canRemove = (caller: OrganizationRole, target: OrganizationRole) =>
  caller === "owner" || (caller === "admin" && target === "member");

function RemoveMemberDialog({
  member,
  organizationId,
}: {
  member: OrganizationMember;
  organizationId: AuthOrganizationMembership["id"];
}) {
  const { actions } = useOrganization();

  const remove = async () => {
    const result = await actions.organize({
      _tag: "RemoveMember",
      organizationId,
      userId: member.userId,
    });
    if (result) toastManager.add({ title: `${member.name} removed`, type: "success" });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button aria-label={`Remove ${member.name}`} size="icon-sm" variant="ghost" />}
      >
        <HugeiconsIcon aria-hidden="true" icon={UserRemove01Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to this store on every device as soon as their session refreshes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />} onClick={() => void remove()}>
            Remove
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemberRow({
  isSelf,
  member,
  organization,
}: {
  isSelf: boolean;
  member: OrganizationMember;
  organization: AuthOrganizationMembership;
}) {
  const { actions } = useOrganization();

  const changeRole = async (role: OrganizationRole) => {
    if (role === member.role) return;
    const result = await actions.organize({
      _tag: "ChangeMemberRole",
      organizationId: organization.id,
      userId: member.userId,
      role,
    });
    if (result) toastManager.add({ title: `${member.name} is now ${role}`, type: "success" });
  };

  return (
    <Frame className="w-full">
      <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
        <Avatar className="size-8">
          <AvatarImage alt={member.name} src={member.image ?? undefined} />
          <AvatarFallback>{initials(member.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{member.name}</p>
          <p className="truncate text-sm text-muted-foreground">{member.email}</p>
        </div>
        {organization.role === "owner" ? (
          <Select
            items={roles}
            onValueChange={(role) => role && void changeRole(role)}
            value={member.role}
          >
            <SelectTrigger aria-label={`Role for ${member.name}`} className="w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {roles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline">{member.role}</Badge>
        )}
        {canRemove(organization.role, member.role) && !isSelf ? (
          <RemoveMemberDialog member={member} organizationId={organization.id} />
        ) : null}
      </FrameHeader>
    </Frame>
  );
}

export function OrganizationMembersCard({
  currentUserId,
  members,
  organization,
}: {
  currentUserId: string;
  members: ReadonlyArray<OrganizationMember>;
  organization: AuthOrganizationMembership;
}) {
  return (
    <FrameCard description="Everyone who can open this store." title="Members">
      <div className="flex flex-col gap-2">
        {members.map((member) => (
          <MemberRow
            isSelf={member.userId === currentUserId}
            key={member.userId}
            member={member}
            organization={organization}
          />
        ))}
      </div>
    </FrameCard>
  );
}
