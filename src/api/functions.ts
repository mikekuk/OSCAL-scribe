import { app, HttpRequest, InvocationContext } from "@azure/functions";
import { authenticator } from "./auth";
import { Service, ApiError } from "./service";
import { cosmos, CosmosRepository, CosmosContent } from "./cosmos";
const client = cosmos(),
  db = client.database(process.env.COSMOS_DATABASE || "scribe");
const service = new Service(
  new CosmosRepository(db.container("ssps")),
  new CosmosContent(db.container("content")),
);
const auth = authenticator(
  process.env.ENTRA_TENANT_ID!,
  process.env.ENTRA_CLIENT_ID!,
);
app.http("api", {
  methods: ["GET", "POST", "PUT"],
  route: "{*path}",
  authLevel: "anonymous",
  handler: async (req: HttpRequest, context: InvocationContext) => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    try {
      let user;
      try {
        user = await auth(req.headers.get("authorization") || undefined);
      } catch {
        throw new ApiError(401, "Valid Entra sign-in required");
      }
      // Bound the stream before allocating/parsing the document, including chunked requests.
      let body = {};
      if (req.body) {
        const reader = req.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_000_000) {
            await reader.cancel();
            throw new ApiError(413, "Request too large");
          }
          chunks.push(value);
        }
        if (size) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            throw new ApiError(400, "Malformed JSON");
          }
        }
      }
      const result = await service.request(
        user,
        req.method,
        new URL(req.url).pathname,
        body,
        req.headers.get("if-match") || undefined,
      );
      return { status: 200, jsonBody: result, headers };
    } catch (e) {
      const error =
        e instanceof ApiError ? e : new ApiError(500, "Request failed");
      context.warn(
        JSON.stringify({
          event: "api-denied-or-failed",
          status: error.status,
          invocationId: context.invocationId,
        }),
      );
      return {
        status: error.status,
        jsonBody: { error: error.message, details: error.details },
        headers,
      };
    }
  },
});
