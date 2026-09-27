export const bearerTokenFromHeaders = (headers: Headers) => {
  const [scheme, token] = (headers.get("authorization") ?? "").split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
};
