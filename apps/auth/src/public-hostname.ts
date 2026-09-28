import { publicHostnameFrom } from "@store/auth/security";

export const resolveProductionAuthHostname = (input: {
  readonly productionDomain: string;
  readonly productionAuthDomain: string;
}) => {
  const root = publicHostnameFrom(input.productionDomain);
  return publicHostnameFrom(input.productionAuthDomain) ?? (root ? `auth.${root}` : undefined);
};
