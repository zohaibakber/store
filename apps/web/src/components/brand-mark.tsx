import { useTheme } from "@/components/theme/provider";

const desktopDevLogo = Boolean(import.meta.env.VITE_ELECTRON && import.meta.env.DEV);

export function BrandMark({ alt = "", className }: { alt?: string; className?: string }) {
  const { theme } = useTheme();
  const src = desktopDevLogo ? "logo-dev.svg" : `logo-${theme}.svg`;

  return <img alt={alt} className={className} src={`${import.meta.env.BASE_URL}${src}`} />;
}
