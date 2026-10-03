import type { PublicClientApplication } from "@azure/msal-browser";
import type { Ssp } from "../shared/types";

interface ApiClientOptions {
  getSession(): PublicClientApplication | undefined;
  getScopes(): string[];
  getPlan(): Ssp | undefined;
}

// Read the current session and version on every request, including after a save.
export function createApiClient(options: ApiClientOptions) {
  return async function api(path: string, method = "GET", data?: unknown) {
    const msal = options.getSession();
    const scopes = options.getScopes();
    let token = "";
    if (msal) {
      const account = msal.getAllAccounts()[0];
      if (!account) throw Error("Please sign in");
      try {
        token = (await msal.acquireTokenSilent({ account, scopes }))
          .accessToken;
      } catch {
        await msal.acquireTokenRedirect({ account, scopes });
        throw Error("Sign-in required");
      }
    }
    const current = options.getPlan();
    const response = await fetch("/api/" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(current ? { "If-Match": String(current.version) } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error([result.error, ...(result.details || [])].join("\n"));
    return result;
  };
}
