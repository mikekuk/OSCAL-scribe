const base = process.env.SCRIBE_URL;
if (!base) throw Error("Set SCRIBE_URL");
if (process.env.API_ONLY !== "true") {
  const home = await fetch(base);
  if (!home.ok || !(await home.text()).includes("<title>OSCAL Scribe</title>"))
    throw Error("OSCAL Scribe web build unavailable");
  const config = await fetch(base + "/config.json");
  if (!config.ok) throw Error("Web sign-in configuration unavailable");
  const settings = await config.json();
  if (!settings.tenantId || !settings.clientId)
    throw Error("Web sign-in configuration incomplete");
}
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
console.log("Deployment reachability, anonymous denial and forged-header denial passed");
