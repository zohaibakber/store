import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function LoadingSpinner({
  className,
  label = "Loading",
}: {
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <div
      aria-busy="true"
      className={cn("flex w-full items-center justify-center text-muted-foreground", className)}
    >
      <Spinner aria-label={label} className="size-5" />
    </div>
  );
}

export function PageLoading() {
  return <LoadingSpinner className="h-full min-h-64 p-4" />;
}
