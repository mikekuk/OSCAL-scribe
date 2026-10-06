import { ApiError } from './service';
import type { User } from '../shared/types';
export const REQUEST_BYTES = 1_000_000;
export const LIBRARY_BYTES = 20_001_000;
export const RESPONSE_BYTES = 60_000_000; // bounded library export / approved baseline
export interface SecurityPolicy { rawBrowser: boolean; permanentDelete: boolean }
export const safePolicy: SecurityPolicy = { rawBrowser: false, permanentDelete: false };
export function runtimePolicy(env: NodeJS.ProcessEnv): SecurityPolicy {
  const flag = (key: string) => {
    if (env[key] !== undefined && !['true','false'].includes(env[key]!)) throw Error(`Invalid ${key}`);
    return env[key] === 'true';
  };
  return { rawBrowser: flag('SCRIBE_ALLOW_RAW_BROWSER'), permanentDelete: flag('SCRIBE_ALLOW_PERMANENT_DELETE') };
}
export function requestLimit(user: User, method: string, path: string) {
  return user.roles.includes('AppAdmin') && method === 'POST' && /^\/(?:api\/)?admin\/library\/?$/.test(path) ? LIBRARY_BYTES : REQUEST_BYTES;
}
export function boundedResponse(value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > RESPONSE_BYTES) throw new ApiError(413, 'Response too large; narrow the request');
  return body;
}
// Deliberately instance-local: bounds local work, not a distributed tenant quota.
// Keep the map bounded and deny new principals when full rather than evicting live counters.
export class RequestLimiter {
  private windows = new Map<string, { until: number; total: number; expensive: number }>();
  constructor(private total = 120, private expensive = 10, private now = Date.now, private capacity = 5000) {
    if (!Number.isInteger(total) || total < 10 || total > 1000 || !Number.isInteger(expensive) || expensive < 1 || expensive > Math.min(total,100)) throw Error('Invalid request limits');
  }
  check(user: User, method: string, path: string) {
    const now = this.now(), key = user.tid + ':' + user.oid;
    let window = this.windows.get(key);
    if (!window || window.until <= now) {
      for (const [id, value] of this.windows) if (value.until <= now) this.windows.delete(id);
      if (this.windows.size >= this.capacity && !this.windows.has(key)) throw new ApiError(429, 'Request capacity reached; try again shortly');
      window = { until: now + 60_000, total: 0, expensive: 0 }; this.windows.set(key, window);
    }
    const costly = method !== 'GET' || /\/(?:raw|export|revisions)(?:\/|$)/.test(path);
    if (++window.total > this.total || (costly && ++window.expensive > this.expensive)) throw new ApiError(429, 'Request limit reached; try again shortly');
  }
}
