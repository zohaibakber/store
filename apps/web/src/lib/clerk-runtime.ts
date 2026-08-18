export {
  CreateOrganization,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@clerk/react";

export const clerkAppearance = {
  variables: {
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
  },
  elements: {
    cardBox: "mx-auto",
    rootBox: "mx-auto w-full",
  },
} as const;
