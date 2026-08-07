import { useTheme } from "@/components/theme/provider";

export function BrandMark({ alt = "", className }: { alt?: string; className?: string }) {
  const { theme } = useTheme();

  return (
    <img alt={alt} className={className} src={`${import.meta.env.BASE_URL}logo-${theme}.svg`} />
  );
}
