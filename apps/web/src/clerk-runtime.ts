export {
  CreateOrganization,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
} from "@clerk/clerk-react";

export const clerkAppearance = {
  variables: {
    fontFamily: '"Inter Variable", sans-serif',
    fontSize: "14px",
  },
} as const;
