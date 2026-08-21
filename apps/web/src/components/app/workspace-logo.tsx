import { BrandMark } from "@/components/brand-mark";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function WorkspaceLogo({ className }: { className?: string }) {
  const snapshot = useAuth().snapshot;
  const organization = snapshot?.status === "authenticated" ? snapshot.activeOrganization : null;
  const name = organization?.name ?? "Tabaaq";

  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0",
        className,
      )}
    >
      {organization?.image ? (
        <img
          alt=""
          className="size-6 shrink-0 rounded-[5px] object-cover"
          src={organization.image}
        />
      ) : (
        <BrandMark alt="" className="size-6 shrink-0 rounded-[5px]" />
      )}
      <span className="truncate font-medium group-data-[collapsible=icon]:hidden">{name}</span>
    </span>
  );
}
