import { UserRemove01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AuthOrganizationMembership, OrganizationMember, OrganizationRole } from "@store/auth";
import { initials } from "@store/services/format";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { formatCount } from "@/lib/format";
import { useOrganization } from "@/lib/organization";

const roles = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

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
    <div className="flex items-center gap-3 px-4 py-2">
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
      ) : organization.role === "owner" || organization.role === "admin" ? (
        <span aria-hidden="true" className="size-8 shrink-0 sm:size-7" />
      ) : null}
    </div>
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
    <FrameCard description={formatCount(members.length, "member")} flush title="Members">
      <div className="flex flex-col divide-y">
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
