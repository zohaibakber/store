export {
  CreateOrganization,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@clerk/electron/react";

export const clerkAppearance = {
  variables: {
    fontFamily: '"Inter Variable", sans-serif',
    fontSize: "14px",
  },
} as const;
