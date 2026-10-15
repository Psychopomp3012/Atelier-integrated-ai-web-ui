import type { RateLimitMeta } from '../../types/api.types.js';

export interface RateLimitCheckResult extends RateLimitMeta {
  allowed: boolean;
  resetTimestamp: number;
}

export class RateLimitService {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly records: Map<string, number[]>;

  constructor(windowMs = 60 * 1000, maxRequests = 1000) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.records = new Map();

    // Auto cleanup stale keys every 2 minutes
    setInterval(() => this.cleanupStaleRecords(), 2 * 60 * 1000).unref();
  }

  /**
   * Check current quota for a client without consuming an execution token.
   */
  public getQuota(key: string): RateLimitCheckResult {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(key, now);
    const count = timestamps.length;
    const remaining = Math.max(0, this.maxRequests - count);

    let resetInSeconds = 0;
    if (timestamps.length > 0) {
      const oldest = timestamps[0];
      resetInSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    }

    const resetTimestamp = Math.floor((now + resetInSeconds * 1000) / 1000);

    return {
      allowed: remaining > 0,
      limit: this.maxRequests,
      remaining,
      resetInSeconds,
      resetTimestamp,
    };
  }

  /**
   * Consume a rate limit token for a client request.
   */
  public consume(key: string): RateLimitCheckResult {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(key, now);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const resetInSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      const resetTimestamp = Math.floor((now + resetInSeconds * 1000) / 1000);

      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetInSeconds,
        resetTimestamp,
      };
    }

    // Record request timestamp
    timestamps.push(now);
    this.records.set(key, timestamps);

    const remaining = this.maxRequests - timestamps.length;
    const oldest = timestamps[0];
    const resetInSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    const resetTimestamp = Math.floor((now + resetInSeconds * 1000) / 1000);

    return {
      allowed: true,
      limit: this.maxRequests,
      remaining,
      resetInSeconds,
      resetTimestamp,
    };
  }

  /**
   * Reset rate limit state for a key (useful for tests or administrative reset).
   */
  public reset(key: string): void {
    this.records.delete(key);
  }

  private getValidTimestamps(key: string, now: number): number[] {
    const list = this.records.get(key) || [];
    const threshold = now - this.windowMs;
    const valid = list.filter((ts) => ts > threshold);
    if (valid.length !== list.length) {
      if (valid.length === 0) {
        this.records.delete(key);
      } else {
        this.records.set(key, valid);
      }
    }
    return valid;
  }

  private cleanupStaleRecords(): void {
    const now = Date.now();
    const threshold = now - this.windowMs;
    for (const [key, timestamps] of this.records.entries()) {
      const valid = timestamps.filter((ts) => ts > threshold);
      if (valid.length === 0) {
        this.records.delete(key);
      } else {
        this.records.set(key, valid);
      }
    }
  }
}

export const rateLimitService = new RateLimitService(60 * 1000, 15);
