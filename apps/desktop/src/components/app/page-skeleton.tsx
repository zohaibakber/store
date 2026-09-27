import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4"
    >
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
