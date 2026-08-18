import { shadcn } from "@clerk/ui/themes";

import { useTheme } from "@/components/theme/provider";

export {
  CreateOrganization,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@clerk/react";

const clerkVariables = {
  borderRadius: "var(--radius)",
  colorBackground: "var(--card)",
  colorBorder: "var(--border)",
  colorDanger: "var(--destructive)",
  colorForeground: "var(--foreground)",
  colorInput: "var(--background)",
  colorInputForeground: "var(--foreground)",
  colorMuted: "var(--muted)",
  colorMutedForeground: "var(--muted-foreground)",
  colorNeutral: "var(--color-neutral-500)",
  colorPrimary: "var(--primary)",
  colorPrimaryForeground: "var(--primary-foreground)",
  colorRing: "var(--ring)",
  colorSuccess: "var(--success)",
  colorWarning: "var(--warning)",
  fontFamily: '"Inter Variable", sans-serif',
  fontFamilyButtons: '"Inter Variable", sans-serif',
  fontFamilyMono: '"Geist Mono Variable", ui-monospace, monospace',
  fontSize: "14px",
  fontWeight: { bold: 500, medium: 500, normal: 400, semibold: 500 },
} as const;

const clerkElements = {
  cardBox: "mx-auto",
  rootBox: "mx-auto w-full",
} as const;

/** Auth screens already render `AuthBrand` above the Clerk card. */
const authScreenOptions = { logoPlacement: "none" as const };

export function clerkAppearance(theme: "light" | "dark") {
  return {
    theme: shadcn,
    cssLayerName: "clerk",
    captcha: { theme },
    options: {
      logoImageUrl: `${import.meta.env.BASE_URL}logo-${theme}.svg`,
      logoPlacement: "inside" as const,
      socialButtonsVariant: "blockButton" as const,
    },
    variables: clerkVariables,
    elements: clerkElements,
    signIn: { options: authScreenOptions },
    signUp: { options: authScreenOptions },
    createOrganization: { options: authScreenOptions },
  };
}

export function useClerkAppearance() {
  const { theme } = useTheme();
  return clerkAppearance(theme);
}
