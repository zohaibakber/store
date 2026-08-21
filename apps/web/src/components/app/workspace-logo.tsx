import { BrandMark } from "@/components/brand-mark";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function WorkspaceLogo({ className }: { className?: string }) {
  const snapshot = useAuth().snapshot;
  const organization = snapshot?.status === "authenticated" ? snapshot.activeOrganization : null;
  const name = organization?.name ?? "Tabaaq";

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      {organization?.image ? (
        <img
          alt=""
          className="size-6 shrink-0 rounded-[5px] object-cover"
          src={organization.image}
        />
      ) : (
        <BrandMark alt="" className="size-6 shrink-0 rounded-[5px]" />
      )}
      <span className="truncate font-medium">{name}</span>
    </span>
  );
}
