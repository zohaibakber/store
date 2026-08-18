import { BrandMark } from "@/components/brand-mark";

export function AppLoading({ label = "Loading" }: { label?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background">
      <div aria-label={label} className="flex size-24 items-center justify-center">
        <BrandMark alt="" className="size-16 rounded-[14px] object-contain" />
      </div>
    </main>
  );
}
