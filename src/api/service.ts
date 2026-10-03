import { randomUUID } from "node:crypto";
import { canRead, canEdit, canShare, canAttest, canAdminister } from "./authz";
import { createSsp, integrity, roles } from "../shared/oscal";
import { validate, bounded } from "../shared/validation";
import type {
  User,
  Ssp,
  Repository,
  ContentStore,
  Json,
  Revision,
  Release,
} from "../shared/types";
import { ApiError } from "./errors";
import { hash } from "./digest";

// Preserve the existing imports used by consumers of the service.
export { ApiError } from "./errors";
export { canonical, hash } from "./digest";

const requireAllowedFields = (body: Json, keys: string[]) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !keys.includes(k))
  )
    throw new ApiError(400, "Unexpected request fields");
};
export class Service {
  constructor(
    public repo: Repository,
    public content: ContentStore,
  ) {}
  async request(
    user: User | undefined,
    method: string,
    path: string,
    body: Json = {},
    match?: string,
  ): Promise<any> {
    if (!user) throw new ApiError(401, "Authentication required");
    if (!user.roles.some((r) => ["User", "Security"].includes(r)))
      throw new ApiError(403, "Application assignment required");
    try {
      bounded(body);
    } catch (e) {
      throw new ApiError(413, (e as Error).message);
    }
    const segments = path
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    if (segments[0] === "me" && method === "GET") return user;
    if (segments[0] === "content" && method === "GET") {
      return this.readContent(segments[1], segments[2]);
    }
    if (segments[0] !== "ssps") throw new ApiError(404, "Not found");
    if (!segments[1]) {
      if (method === "GET")
        return (await this.repo.list(user)).map((plan) => ({
          ...plan,
          oscal: undefined,
          title: plan.oscal["system-security-plan"].metadata.title,
          systemName:
            plan.oscal["system-security-plan"]["system-characteristics"][
              "system-name"
            ],
        }));
      if (method !== "POST") throw new ApiError(405, "Method not allowed");
      return this.createPlan(user, body);
    }
    const plan = await this.repo.get(segments[1]);
    if (!plan || !canRead(user, plan)) throw new ApiError(404, "SSP not found");
    if (method === "GET") {
      if (!segments[2]) return plan;
      if (segments[2] === "revisions") {
        const revisions = await this.repo.records(plan.sspId, "revision:");
        if (segments[3]) {
          const r = revisions.find((x) => String(x.revision) === segments[3]);
          if (!r) throw new ApiError(404, "Revision not found");
          return r;
        }
        return revisions.map((r) => ({ ...r, oscal: undefined }));
      }
      if (segments[2] === "attestations")
        return this.repo.records(plan.sspId, "attestation:");
    }
    if (segments[2] === "validate" && method === "POST") {
      requireAllowedFields(body, ["oscal"]);
      const release = await this.content.get(plan.releaseId),
        profile = release.profiles.find((x) => x.id === plan.profileId)!;
      const doc = body.oscal || plan.oscal;
      return {
        errors: [...validate(doc), ...integrity(doc, profile, release.id)],
      };
    }
    return this.mutatePlan(
      user,
      plan,
      segments[2] || "update",
      method,
      body,
      match,
    );
  }

  private async readContent(releaseId?: string, profileId?: string) {
    const release = releaseId
      ? await this.content.get(releaseId)
      : await this.content.active();
    if (profileId) {
      const profile = release.profiles.find((x) => x.id === profileId);
      if (!profile) throw new ApiError(404, "Profile not found");
      return {
        releaseId: release.id,
        profile,
        components: release.components,
        sources: release.sources,
      };
    }
    return {
      id: release.id,
      demo: release.demo,
      profiles: release.profiles.map(({ id, title }) => ({ id, title })),
      components: release.components,
    };
  }

  private async createPlan(user: User, body: Json) {
    requireAllowedFields(body, ["releaseId", "profileId", "systemName"]);
    if (
      typeof body.systemName !== "string" ||
      body.systemName.trim().length < 1 ||
      body.systemName.length > 200
    )
      throw new ApiError(400, "System name required (1–200 characters)");
    const release = await this.content.active();
    if (body.releaseId !== release.id)
      throw new ApiError(409, "Select the current approved content release");
    const profile = release.profiles.find((x) => x.id === body.profileId);
    if (!profile) throw new ApiError(400, "Approved profile required");
    const oscal = createSsp(body.systemName.trim(), profile, release.id),
      now = new Date().toISOString();
    const plan: Ssp = {
      id: "current",
      sspId: oscal["system-security-plan"].uuid,
      tenantId: user.tid,
      ownerId: user.oid,
      access: [],
      createdAt: now,
      createdBy: user.oid,
      modifiedAt: now,
      modifiedBy: user.oid,
      currentRevision: 1,
      version: 1,
      archived: false,
      releaseId: release.id,
      profileId: profile.id,
      oscal,
    };
    this.valid(oscal, profile, release.id);
    await this.repo.create(
      plan,
      this.revision(plan),
      this.audit(plan, user, "create"),
    );
    return plan;
  }

  // Authorise and check the version before changing a cloned plan. Persist once.
  private async mutatePlan(
    user: User,
    plan: Ssp,
    operation: string,
    method: string,
    body: Json,
    match?: string,
  ) {
    const permissions: Record<string, (user: User, plan: Ssp) => boolean> = {
      update: canEdit,
      share: canShare,
      attest: canAttest,
      archive: canAdminister,
    };
    const permission = Object.hasOwn(permissions, operation)
      ? permissions[operation]
      : undefined;
    if (!permission || !permission(user, plan))
      throw new ApiError(403, "Operation not permitted");
    if (match !== String(plan.version))
      throw new ApiError(409, "The SSP changed. Reload before saving.");
    const next = structuredClone(plan),
      now = new Date().toISOString();
    next.version++;
    next.modifiedAt = now;
    next.modifiedBy = user.oid;
    const records: Json[] = [];
    if (operation === "update" && method === "PUT") {
      await this.updateDocument(plan, next, body, now, records);
    } else if (operation === "share" && method === "POST") {
      this.updateSharing(next, body);
    } else if (operation === "archive" && method === "POST") {
      requireAllowedFields(body, []);
      next.archived = true;
    } else if (operation === "attest" && method === "POST") {
      this.attestRevision(plan, next, user, body, now, records);
    } else throw new ApiError(405, "Method not allowed");
    records.push(this.audit(next, user, operation));
    await this.repo.commit(plan, next, records);
    return next;
  }
  private async updateDocument(
    previous: Ssp,
    next: Ssp,
    body: Json,
    now: string,
    records: Json[],
  ) {
    requireAllowedFields(body, ["oscal"]);
    const release = await this.content.get(previous.releaseId),
      profile = release.profiles.find((x) => x.id === previous.profileId)!;
    if (body.oscal?.["system-security-plan"]?.uuid !== previous.sspId)
      throw new ApiError(422, "SSP UUID cannot change");
    const document = structuredClone(body.oscal);
    if (!document?.["system-security-plan"]?.metadata)
      throw new ApiError(422, "SSP metadata required");
    document["system-security-plan"].metadata["last-modified"] = now;
    document["system-security-plan"].metadata.version = String(
      previous.currentRevision + 1,
    );
    this.valid(document, profile, release.id);
    next.oscal = document;
    next.currentRevision++;
    records.push(this.revision(next));
  }

  private updateSharing(next: Ssp, body: Json) {
    requireAllowedFields(body, ["oid", "permission"]);
    if (
      !/^[0-9a-f-]{36}$/i.test(body.oid) ||
      !["read", "edit", "remove"].includes(body.permission)
    )
      throw new ApiError(
        400,
        "Entra object ID and read/edit/remove permission required",
      );
    next.access = next.access.filter((x) => x.oid !== body.oid);
    if (body.permission !== "remove")
      next.access.push({ oid: body.oid, permission: body.permission });
    if (next.access.length > 100)
      throw new ApiError(400, "Maximum 100 sharing entries");
  }

  private attestRevision(
    previous: Ssp,
    next: Ssp,
    user: User,
    body: Json,
    now: string,
    records: Json[],
  ) {
    requireAllowedFields(body, ["revision", "systemRole"]);
    if (body.revision !== previous.currentRevision)
      throw new ApiError(409, "Attest the current saved revision");
    if (!roles.some(([id]) => id === body.systemRole))
      throw new ApiError(400, "Select a system role");
    const document = previous.oscal["system-security-plan"];
    if (
      roles.some(
        ([id]) =>
          !document.metadata["responsible-parties"]?.some(
            (r: Json) => r["role-id"] === id && r["party-uuids"]?.length,
          ),
      )
    )
      throw new ApiError(
        422,
        "Assign all four system roles before attestation",
      );
    const date = new Date(now);
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    const attestation = {
      id: "attestation:" + randomUUID(),
      sspId: previous.sspId,
      revision: previous.currentRevision,
      actor: user.oid,
      systemRole: body.systemRole,
      at: now,
      due: date.toISOString(),
      hash: hash(previous.oscal),
    };
    next.lastAttestation = attestation;
    records.push(attestation);
  }

  valid(doc: Json, profile: Release["profiles"][number], releaseId: string) {
    const errors = validate(doc);
    if (!errors.length) errors.push(...integrity(doc, profile, releaseId));
    if (errors.length)
      throw new ApiError(422, "OSCAL validation failed", errors);
  }
  revision(plan: Ssp): Revision {
    return {
      id: "revision:" + plan.currentRevision,
      sspId: plan.sspId,
      revision: plan.currentRevision,
      actor: plan.modifiedBy,
      at: plan.modifiedAt,
      releaseId: plan.releaseId,
      profileId: plan.profileId,
      hash: hash(plan.oscal),
      oscal: structuredClone(plan.oscal),
    };
  }
  audit(plan: Ssp, user: User, event: string) {
    return {
      id: "audit:" + randomUUID(),
      sspId: plan.sspId,
      event,
      actor: user.oid,
      at: new Date().toISOString(),
      revision: plan.currentRevision,
    };
  }
}
