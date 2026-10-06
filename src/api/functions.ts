import { runtimePolicy, RequestLimiter, requestLimit, boundedResponse } from "./security";
import { GraphDirectory } from "./directory";
import { CosmosAdminStore } from "./cosmos-admin";
import { app, HttpRequest, InvocationContext } from "@azure/functions";
import { authenticator } from "./auth";
import { Service, ApiError } from "./service";
import { cosmos, CosmosRepository, CosmosContent } from "./cosmos";
const client = cosmos(),
  db = client.database(process.env.COSMOS_DATABASE || "scribe");
const service = new Service(
  new CosmosRepository(db.container("ssps")),
  new CosmosContent(db.container("content")),
  new CosmosAdminStore(db),
  new GraphDirectory(process.env.ENTRA_TENANT_ID!),
  runtimePolicy(process.env),
);
const auth = authenticator(
  process.env.ENTRA_TENANT_ID!,
  process.env.ENTRA_CLIENT_ID!,
);
const limiter = new RequestLimiter(Number(process.env.SCRIBE_REQUESTS_PER_MINUTE || 120), Number(process.env.SCRIBE_EXPENSIVE_REQUESTS_PER_MINUTE || 10));
app.http("api", {
  methods: ["GET", "POST", "PUT", "DELETE"],
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
      const url = new URL(req.url);
      limiter.check(user, req.method, url.pathname);
      if (req.body && !/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')) throw new ApiError(415, 'Use application/json');
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
          if (size > requestLimit(user, req.method, url.pathname)) {
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
        url.pathname + url.search,
        body,
        req.headers.get("if-match") || undefined,
      );
      const response = boundedResponse(result);
      // Metadata only; never log documents, query text, credentials or tokens.
      context.log(JSON.stringify({event: 'api-authorized', actor: user.oid, tenant: user.tid, method: req.method, operation: url.pathname.split('/').slice(0,3).join('/'), invocationId: context.invocationId}));
      return { status: 200, body: response, headers };
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
        headers: { ...headers, ...(error.status === 429 ? { "Retry-After": "60" } : {}) },
      };
    }
  },
});
