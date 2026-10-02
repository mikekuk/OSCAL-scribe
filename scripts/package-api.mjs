import { mkdir, writeFile, readFile } from "node:fs/promises";
const p = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("dist/api", { recursive: true });
await writeFile(
  "dist/api/package.json",
  JSON.stringify({
    name: p.name,
    type: "module",
    main: "functions.js",
    dependencies: p.dependencies,
  }),
);
await writeFile(
  "dist/api/host.json",
  JSON.stringify({
    version: "2.0",
    logging: {
      applicationInsights: {
        samplingSettings: { isEnabled: true, maxTelemetryItemsPerSecond: 5 },
      },
    },
    extensions: {
      http: {
        routePrefix: "api",
        maxOutstandingRequests: 50,
        maxConcurrentRequests: 20,
      },
    },
  }),
);
