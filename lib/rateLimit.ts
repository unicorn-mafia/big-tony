/**
 * In-process sliding-window rate limiting for the public API routes.
 *
 * This is a speed bump, not a guarantee: the counters live in memory, so they
 * reset on a cold start and are not shared between instances. It is enough to
 * stop a runaway agent loop or a burst from a leaked API key. The durable cap
 * on how much can actually reach Google Contacts lives in `googleContacts.ts`,
 * which derives its budget from the contact list itself.
 */

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  hits: number[];
  windowMs: number;
}

/** Drop expired buckets at most this often, to keep `check` cheap. */
const SWEEP_INTERVAL_MS = 60_000;

/** Hard ceiling on tracked keys, so a wide key space cannot grow the map. */
const MAX_KEYS = 10_000;

export class SlidingWindowRateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  check(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now()
  ): RateLimitDecision {
    this.sweep(now);

    const cutoff = now - windowMs;
    const previous = this.buckets.get(key)?.hits ?? [];
    const hits = previous.filter((timestamp) => timestamp > cutoff);

    if (hits.length >= limit) {
      this.buckets.set(key, { hits, windowMs });
      const oldest = hits[0];
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    hits.push(now);
    this.buckets.set(key, { hits, windowMs });

    return {
      allowed: true,
      limit,
      remaining: limit - hits.length,
      retryAfterSeconds: 0,
    };
  }

  /** Test seam - lets a suite start from a known state. */
  reset(): void {
    this.buckets.clear();
    this.lastSweepAt = 0;
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS && this.buckets.size < MAX_KEYS) {
      return;
    }
    this.lastSweepAt = now;

    for (const [key, bucket] of this.buckets) {
      const newest = bucket.hits[bucket.hits.length - 1] ?? 0;
      if (newest + bucket.windowMs <= now) {
        this.buckets.delete(key);
      }
    }

    // Still oversized: evict the least recently used keys rather than clearing
    // the map, which would hand an attacker a way to wipe the limits.
    if (this.buckets.size > MAX_KEYS) {
      const byAge = [...this.buckets.entries()].sort(
        (a, b) =>
          (a[1].hits[a[1].hits.length - 1] ?? 0) - (b[1].hits[b[1].hits.length - 1] ?? 0)
      );
      for (const [key] of byAge.slice(0, this.buckets.size - MAX_KEYS)) {
        this.buckets.delete(key);
      }
    }
  }
}

/** Shared across requests handled by the same instance. */
export const submitMemberLimiter = new SlidingWindowRateLimiter();

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export interface SubmitMemberLimits {
  totalLimit: number;
  totalWindowMs: number;
  phoneLimit: number;
  phoneWindowMs: number;
}

export function submitMemberLimits(): SubmitMemberLimits {
  return {
    totalLimit: envInt("SUBMIT_MEMBER_RATE_LIMIT", 10),
    totalWindowMs: envInt("SUBMIT_MEMBER_RATE_WINDOW_MS", 60_000),
    phoneLimit: envInt("SUBMIT_MEMBER_PHONE_LIMIT", 3),
    phoneWindowMs: envInt("SUBMIT_MEMBER_PHONE_WINDOW_MS", 3_600_000),
  };
}

/**
 * Overall throughput guard, checked before the request body is even parsed so
 * a flood of junk cannot cost us GitHub or Google calls.
 */
export function checkOverallRate(
  limiter: SlidingWindowRateLimiter = submitMemberLimiter,
  now?: number
): RateLimitDecision {
  const limits = submitMemberLimits();
  return limiter.check("submitMember:all", limits.totalLimit, limits.totalWindowMs, now);
}

/**
 * Per-person guard, so one number cannot be resubmitted in a loop. Keyed on the
 * raw value: normalisation happens later, and an unnormalisable number should
 * still be rate limited.
 */
export function checkPhoneRate(
  phone: string,
  limiter: SlidingWindowRateLimiter = submitMemberLimiter,
  now?: number
): RateLimitDecision {
  const limits = submitMemberLimits();
  return limiter.check(
    `submitMember:phone:${phone.replace(/\D/g, "")}`,
    limits.phoneLimit,
    limits.phoneWindowMs,
    now
  );
}
