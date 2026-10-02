const base = process.env.SCRIBE_URL;
if (!base) throw Error("Set SCRIBE_URL");
const home = await fetch(base);
if (!home.ok) throw Error("Web app unavailable");
const api = await fetch(base + "/api/ssps");
if (![401, 403].includes(api.status))
  throw Error("Anonymous API was not denied: " + api.status);
const forged = await fetch(base + "/api/ssps", {
  headers: {
    "x-ms-client-principal": Buffer.from(
      JSON.stringify({ userId: "forged", userRoles: ["Security"] }),
    ).toString("base64"),
  },
});
if (![401, 403].includes(forged.status))
  throw Error("Forged identity header accepted");
if (process.env.SCRIBE_TOKEN) {
  const r = await fetch(base + "/api/content", {
    headers: { Authorization: "Bearer " + process.env.SCRIBE_TOKEN },
  });
  if (!r.ok) throw Error("Authenticated content unavailable " + r.status);
  console.log("Authenticated content check passed");
}
console.log(
  "Web reachability, anonymous denial and forged-header denial passed",
);
