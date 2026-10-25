import { test } from "node:test";
import assert from "node:assert/strict";
import { ManagedIdentityCredential } from "@azure/identity";

test("Azure Functions managed identity acquires Graph and Cosmos tokens through the installed MSAL dependency", async () => {
  const names = ["IDENTITY_ENDPOINT", "IDENTITY_HEADER", "IDENTITY_SERVER_THUMBPRINT", "MSI_ENDPOINT", "MSI_SECRET", "AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_FEDERATED_TOKEN_FILE"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.IDENTITY_ENDPOINT = "http://127.0.0.1:8081/identity/token";
  process.env.IDENTITY_HEADER = "local-test-header";
  try {
    const requests: URL[] = [];
    const expiresOn = Math.floor(Date.now() / 1000) + 3600;
    const credential = new ManagedIdentityCredential({
      retryOptions: { maxRetries: 0 },
      httpClient: {
        async sendRequest(request) {
          const url = new URL(request.url);
          assert.equal(url.origin, "http://127.0.0.1:8081");
          assert.equal(request.headers.get("x-identity-header"), "local-test-header");
          requests.push(url);
          return {
            request,
            status: 200,
            headers: request.headers,
            bodyAsText: JSON.stringify({
              access_token: "local-test-token",
              expires_on: String(expiresOn),
              resource: url.searchParams.get("resource"),
              token_type: "Bearer",
            }),
          };
        },
      },
    });
    for (const resource of ["https://graph.microsoft.com", "https://cosmos.azure.com"]) {
      const token = await credential.getToken(`${resource}/.default`);
      assert.equal(token.token, "local-test-token");
      assert.equal(token.expiresOnTimestamp, expiresOn * 1000);
    }
    assert.deepEqual(requests.map(url => url.searchParams.get("resource")), ["https://graph.microsoft.com", "https://cosmos.azure.com"]);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
