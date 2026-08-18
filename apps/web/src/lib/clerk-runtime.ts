export {
  CreateOrganization,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
  useSignIn,
  useSignUp,
} from "@clerk/react";

export const clerkAppearance = {
  variables: {
    fontFamily: '"Inter Variable", sans-serif',
    fontSize: "14px",
  },
} as const;
