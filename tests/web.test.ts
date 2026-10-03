import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClientApplication } from "@azure/msal-browser";
import type { PinnedBaseline, Ssp } from "../src/shared/types";
import { createApiClient } from "../src/web/api";
import { buildControlRows } from "../src/web/baseline";
import { renderField } from "../src/web/fields";

test("API requests use the latest version after saving and omit it outside a plan", async (t) => {
  let plan = { version: 1 } as Ssp | undefined;
  const requests: RequestInit[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      requests.push(options);
      return Response.json({ version: 2 });
    },
  );
  const api = createApiClient({
    getSession: () => undefined,
    getScopes: () => [],
    getPlan: () => plan,
  });
  const saved = await api("ssps/one", "PUT", { oscal: {} });
  plan = saved;
  await api("ssps/one/share", "POST", {});
  plan = undefined;
  await api("ssps");
  assert.equal(new Headers(requests[0].headers).get("If-Match"), "1");
  assert.equal(new Headers(requests[1].headers).get("If-Match"), "2");
  assert.equal(new Headers(requests[2].headers).get("If-Match"), null);
  assert.equal(requests[0].body, JSON.stringify({ oscal: {} }));
  assert.equal(requests[2].body, undefined);
});

test("API client sends the access token and preserves server validation details", async (t) => {
  const account = { homeAccountId: "test" };
  const scopes = ["api://scribe/access_as_user"];
  const session = {
    getAllAccounts: () => [account],
    acquireTokenSilent: async (request: unknown) => {
      assert.deepEqual(request, { account, scopes });
      return { accessToken: "test-token" };
    },
  } as unknown as PublicClientApplication;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer test-token",
      );
      return Response.json(
        { error: "Invalid document", details: ["Missing title"] },
        { status: 422 },
      );
    },
  );
  const api = createApiClient({
    getSession: () => session,
    getScopes: () => scopes,
    getPlan: () => undefined,
  });
  await assert.rejects(
    api("ssps/one", "PUT", {}),
    /Invalid document\nMissing title/,
  );
});

test("failed silent sign-in redirects without sending an unauthenticated request", async (t) => {
  let redirected = false;
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Request must not be sent"),
  );
  const session = {
    getAllAccounts: () => [{}],
    acquireTokenSilent: async () => {
      throw Error("Expired session");
    },
    acquireTokenRedirect: async () => {
      redirected = true;
    },
  } as unknown as PublicClientApplication;
  const api = createApiClient({
    getSession: () => session,
    getScopes: () => [],
    getPlan: () => undefined,
  });
  await assert.rejects(api("ssps"), /Sign-in required/);
  assert.equal(redirected, true);
});

test("resolved controls remain authoritative when source preview is unavailable", () => {
  const baseline: PinnedBaseline = {
    releaseId: "release",
    profile: {
      id: "profile",
      title: "Baseline",
      path: "profile.json",
      resolved: {
        catalog: { controls: [{ id: "ac-1", title: "Resolved requirement" }] },
      },
    },
    sources: [],
    components: [],
  };
  const before = structuredClone(baseline);
  assert.equal(
    buildControlRows(baseline)[0].control.title,
    "Resolved requirement",
  );
  assert.deepEqual(baseline, before);
});

test("fields escape untrusted text and retain edit and selection states", () => {
  const html = renderField(
    "<Label>",
    "metadata/title",
    "</textarea><script>alert(1)</script>",
    false,
    "textarea",
  );
  assert.ok(html.includes("&lt;Label&gt;"));
  assert.ok(html.includes("&lt;/textarea&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("disabled"));
  assert.ok(
    renderField("Status", "status", "planned", true, "select", [
      "planned",
      "implemented",
    ]).includes("<option selected>planned</option>"),
  );
  assert.ok(
    !renderField("Title", "title", "Example", true).includes("disabled"),
  );
});
