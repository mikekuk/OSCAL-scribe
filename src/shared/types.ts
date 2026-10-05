export type Json = Record<string, any>;
export interface User {
  oid: string;
  tid: string;
  roles: string[];
}
export interface Access {
  oid: string;
  permission: "read" | "edit";
}
export interface Ssp {
  id: "current";
  sspId: string;
  ownerId: string;
  tenantId: string;
  access: Access[];
  createdBy: string;
  createdAt: string;
  modifiedBy: string;
  modifiedAt: string;
  currentRevision: number;
  version: number;
  archived: boolean;
  deleting?: boolean;
  releaseId: string;
  profileId: string;
  oscal: Json;
  lastAttestation?: Attestation;
  _etag?: string;
}
export interface Attestation {
  id: string;
  sspId: string;
  revision: number;
  actor: string;
  systemRole: string;
  at: string;
  due: string;
  hash: string;
}
export interface Revision {
  id: string;
  sspId: string;
  revision: number;
  actor: string;
  at: string;
  releaseId: string;
  profileId: string;
  hash: string;
  oscal: Json;
}
export interface Release {
  id: string;
  demo: boolean;
  sources: { path: string; doc: Json }[];
  profiles: { id: string; title: string; path: string; resolved: Json }[];
  components: Json[];
  provenance: Json;
}
export interface ContentStore {
  active(): Promise<Release>;
  get(id: string): Promise<Release>;
}
export interface Repository {
  list(user: User): Promise<Ssp[]>;
  get(id: string): Promise<Ssp | undefined>;
  create(ssp: Ssp, revision: Revision, audit: Json): Promise<void>;
  commit(previous: Ssp, next: Ssp, records: Json[]): Promise<void>;
  records(id: string, prefix: string): Promise<Json[]>;
  purge(ssp: Ssp): Promise<void>;
  adminPage(user: User, query: string, state: string, cursor?: string): Promise<{ items: Json[]; cursor?: string }>;
}
