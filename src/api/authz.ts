import type { User, Ssp } from "../shared/types";
export const security = (u: User) => u.roles.includes("Security");
const tenant = (u: User, s: Ssp) => u.tid === s.tenantId;
export const canAdminister = (u: User, s: Ssp) =>
  tenant(u, s) && (security(u) || s.ownerId === u.oid);
export const canRead = (u: User, s: Ssp) =>
  tenant(u, s) &&
  (canAdminister(u, s) || s.access.some((a) => a.oid === u.oid));
export const canEdit = (u: User, s: Ssp) =>
  !s.archived &&
  tenant(u, s) &&
  (canAdminister(u, s) ||
    s.access.some((a) => a.oid === u.oid && a.permission === "edit"));
export const canShare = canAdminister;
export const canAttest = (u: User, s: Ssp) =>
  !s.archived && canAdminister(u, s);
