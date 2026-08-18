import { Spinner } from "@/components/ui/spinner";

export function AppLoading({ label = "Loading" }: { label?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">
      <Spinner aria-label={label} className="size-6" />
    </main>
  );
}
