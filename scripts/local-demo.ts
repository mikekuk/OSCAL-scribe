import { MemoryAdminStore } from "../src/api/memory-admin";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Service, ApiError } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
if (process.env.WEBSITE_INSTANCE_ID)
  throw Error("Local demo cannot run in Azure");
const release = JSON.parse(await readFile("work/content-release.json", "utf8"));
const repo = new MemoryRepository();
const demoPeople = [
  { oid: "11111111-1111-4111-8111-111111111111", displayName: "Demo author", email: "author@example.test" },
  { oid: "33333333-3333-4333-8333-333333333333", displayName: "Alex Reviewer", email: "alex@example.test" },
  { oid: "44444444-4444-4444-8444-444444444444", displayName: "Alex Reviewer", userPrincipalName: "alex_external.test#EXT#@demo.test", guest: true },
];
const demoDirectory = {
  lookup: async (_tenant: string, oid: string) => demoPeople.find(p => p.oid === oid),
  search: async (_tenant: string, query: string) => demoPeople.filter(p => [p.displayName, p.email, p.userPrincipalName].some(v => v?.toLowerCase().startsWith(query.toLowerCase()))),
};
const service = new Service(repo, {
  active: async () => release,
  get: async (id) => {
    if (id !== release.id) throw new ApiError(404, "Release not found");
    return release;
  },
}, new MemoryAdminStore(repo, release), demoDirectory);
const user = {
  oid: "11111111-1111-4111-8111-111111111111",
  tid: "22222222-2222-4222-8222-222222222222",
  roles: process.env.DEMO_APP_ADMIN === "true" ? ["AppAdmin"] : ["User"],
};
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.url === "/api/config") {
      res.end(JSON.stringify({ localDemo: true }));
      return;
    }
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > (user.roles.includes("AppAdmin") && req.url === "/api/admin/library" ? 20_001_000 : 1000000))
        throw new ApiError(413, "Too large");
    }
    const result = await service.request(
      user,
      req.method!,
      req.url!,
      data ? JSON.parse(data) : {},
      req.headers["if-match"] as string,
    );
    res.end(JSON.stringify(result));
  } catch (e: any) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message, details: e.details }));
  }
}).listen(7071, "127.0.0.1", () =>
  console.log(
    "Explicit DEMO API: http://127.0.0.1:7071 — memory only, restart clears SSPs",
  ),
);
