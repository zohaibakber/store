import { useTheme } from "@/components/theme/provider";

const desktopDevLogo = import.meta.env.DEV;

export function BrandMark({ className }: { className?: string }) {
  const { theme } = useTheme();
  const src = desktopDevLogo ? "logo-dev.svg" : `logo-${theme}.svg`;

  return <img alt="" className={className} src={`${import.meta.env.BASE_URL}${src}`} />;
}
