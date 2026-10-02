import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { User } from "../shared/types";
export function authenticator(
  tenantId: string,
  audience: string,
  key?: JWTVerifyGetKey,
) {
  if (!tenantId || !audience) throw Error("Entra configuration required");
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks =
    key ||
    createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      ),
    );
  return async (header: string | undefined): Promise<User> => {
    if (!header?.startsWith("Bearer ")) throw Error("Authentication required");
    const { payload: p } = await jwtVerify(header.slice(7), jwks, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "oid", "tid"],
    });
    if (
      p.tid !== tenantId ||
      typeof p.oid !== "string" ||
      !String(p.scp || "")
        .split(" ")
        .includes("access_as_user")
    )
      throw Error("Invalid delegated identity");
    const roles = Array.isArray(p.roles)
      ? p.roles.filter((r): r is string => typeof r === "string")
      : [];
    if (!roles.some((r) => ["User", "Security"].includes(r)))
      throw Error("Application assignment required");
    return { oid: p.oid, tid: tenantId, roles };
  };
}
