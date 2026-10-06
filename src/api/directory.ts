import { ManagedIdentityCredential } from "@azure/identity";
import type { Person } from "../shared/types";
import { ApiError } from "./service";
export interface Directory {
  lookup(tenant: string, oid: string, fresh?: boolean): Promise<Person | undefined>;
  search(tenant: string, query: string): Promise<Person[]>;
}
/** One tenant, fixed Graph routes, basic fields only. No caller-controlled URL,
 * access token, filter expression, or pagination link is forwarded to Graph. */
export class GraphDirectory implements Directory {
  private cache = new Map<string, { expires: number; person?: Person }>();
  constructor(private tenant: string, private credential = new ManagedIdentityCredential(), private request: typeof fetch = fetch) {}
  private async get(tenant: string, path: string) {
    if (tenant !== this.tenant) throw new ApiError(403, "Directory tenant mismatch");
    try {
      const token = await this.credential.getToken("https://graph.microsoft.com/.default");
      const response = await this.request("https://graph.microsoft.com/v1.0/" + path, { headers: { Authorization: "Bearer " + token.token }, signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw Error("Directory request failed");
      return await response.json();
    } catch { throw new ApiError(503, "Directory lookup is unavailable. Try again shortly or ask an administrator to check Microsoft Graph consent."); }
  }
  private person(value: any): Person {
    return { oid: value.id, displayName: value.displayName || value.mail || value.userPrincipalName || "Unnamed user", ...(value.mail ? { email: value.mail } : {}), ...(value.userPrincipalName ? { userPrincipalName: value.userPrincipalName } : {}), ...(value.userType === "Guest" ? { guest: true } : {}) };
  }
  async lookup(tenant: string, oid: string, fresh = false) {
    if (tenant !== this.tenant) throw new ApiError(403, "Directory tenant mismatch");
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(oid)) throw new ApiError(400, "Invalid user ID");
    const cached = this.cache.get(oid);
    if (!fresh && cached && cached.expires > Date.now()) return cached.person;
    const data = await this.get(tenant, "users/" + oid + "?$select=id,displayName,mail,userPrincipalName,userType");
    const person = data ? this.person(data) : undefined;
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(oid, { expires: Date.now() + 300000, person });
    return person;
  }
  async search(tenant: string, query: string) {
    if (typeof query !== "string" || query.trim().length < 3 || query.length > 100) throw new ApiError(400, "Enter 3–100 characters to search for a person");
    // Escape OData literals before URL encoding; apostrophes are valid in names.
    const text = query.trim().replace(/'/g, "''");
    const params = new URLSearchParams({ "$select": "id,displayName,mail,userPrincipalName,userType", "$top": "20", "$filter": ["displayName", "mail", "userPrincipalName"].map(field => `startswith(${field},'${text}')`).join(" or ") });
    const data = await this.get(tenant, "users?" + params);
    return (data?.value || []).slice(0, 20).map((v: any) => this.person(v));
  }
}
