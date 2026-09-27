import { auth, people, people_v1 } from "@googleapis/people";

import {
  phonesMatch,
  toContactData,
  type NormalizedContactData,
} from "./contactData";

export type GoogleContactSyncStatus =
  | "created"
  | "enriched"
  | "already_exists"
  | "skipped"
  | "invalid"
  | "rate_limited"
  | "failed";

export interface GoogleContactSyncResult {
  status: GoogleContactSyncStatus;
  message: string;
  resourceName?: string;
  /** Field names that were filled in on an existing contact. */
  filled?: string[];
}

export interface MemberContactInput {
  name: string;
  phone: string;
  company?: string;
  role?: string;
  github?: string;
  linkedin?: string;
  refererName?: string;
}

/**
 * The only slice of the People API this service may touch.
 *
 * The `contacts` OAuth scope is necessarily read-write and carries the right to
 * delete - Google offers no create-and-update-but-not-delete scope. So the
 * restriction is enforced here instead: narrowing the client to these three
 * operations makes `deleteContact`, `batchDeleteContacts` and
 * `deleteContactPhoto` compile errors rather than a judgement call. A matching
 * regression test in scripts/test-google-contacts.mts fails if any destructive
 * call is ever added to lib/.
 */
type ContactsClient = {
  people: Pick<people_v1.Resource$People, "createContact" | "updateContact"> & {
    connections: Pick<people_v1.Resource$People$Connections, "list">;
  };
};

/** Fields we read when scanning for an existing contact and when merging. */
const PERSON_FIELDS = "names,phoneNumbers,organizations,urls,biographies,metadata";

/**
 * Stamped into the notes of every contact this service creates. It is what
 * lets the daily budget below count our own writes without a database.
 */
export const CONTACT_MARKER = "Source: Unicorn Mafia onboarding (Big Tony)";

/**
 * Phone numbers this process has just created a contact for.
 *
 * `people.connections.list` does not return a contact immediately after it is
 * created - there is a propagation delay of a minute or more. Two submissions
 * of the same person inside that window would both scan clean and both create,
 * producing exactly the duplicate the phone-number check exists to prevent.
 *
 * Module-level, so it survives the per-request `new GoogleContactsService()`.
 * Per-process, so it does not help across instances - the durable guard for the
 * main path is that a repeat submission finds an open PR and is not allowed to
 * create. See `allowCreate`.
 */
const recentCreates = new Map<string, number>();
const CREATE_MEMO_MS = 15 * 60 * 1000;
const MAX_MEMO_ENTRIES = 1000;

function rememberCreate(phoneE164: string, now: number = Date.now()): void {
  if (recentCreates.size >= MAX_MEMO_ENTRIES) {
    for (const [phone, at] of recentCreates) {
      if (now - at > CREATE_MEMO_MS) {
        recentCreates.delete(phone);
      }
    }
  }
  recentCreates.set(phoneE164, now);
}

function createdRecently(phoneE164: string, now: number = Date.now()): boolean {
  const at = recentCreates.get(phoneE164);
  if (at === undefined) {
    return false;
  }
  if (now - at > CREATE_MEMO_MS) {
    recentCreates.delete(phoneE164);
    return false;
  }
  return true;
}

/** Test seam - lets a suite start from a known state. */
export function resetRecentCreates(): void {
  recentCreates.clear();
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DAILY_LIMIT = 25;
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 25; // 25k contacts; guards against an unbounded scan.

export class GoogleContactsService {
  private peopleService?: ContactsClient;
  private enabled: boolean;
  private requestTimeoutMs: number;
  private dailyLimit: number;
  private disabledReason?: string;

  constructor() {
    this.requestTimeoutMs = resolveTimeoutMs(process.env.GOOGLE_CONTACTS_TIMEOUT_MS);
    this.dailyLimit = resolvePositiveInt(
      process.env.GOOGLE_CONTACTS_DAILY_LIMIT,
      DEFAULT_DAILY_LIMIT
    );

    // Kill switch: stops all writes without having to remove credentials.
    if (process.env.GOOGLE_CONTACTS_SYNC_ENABLED === "false") {
      this.enabled = false;
      this.disabledReason = "Google Contacts sync is turned off.";
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      this.enabled = false;
      this.disabledReason = "Google Contacts sync is not configured.";
      return;
    }

    const oauth2Client = new auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    this.peopleService = people({ version: "v1", auth: oauth2Client });
    this.enabled = true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add a member to Google Contacts, keyed on phone number.
   *
   * - Data is validated and normalised first; an unusable phone number aborts
   *   the write rather than creating an un-deduplicable contact.
   * - If a contact with the same phone number already exists it is never
   *   overwritten. Only fields that are currently empty on that contact get
   *   filled in.
   *
   * Never throws - a sync failure must not fail the member's join request.
   */
  async syncMemberContact(
    member: MemberContactInput,
    prUrl?: string,
    options: { allowCreate?: boolean } = {}
  ): Promise<GoogleContactSyncResult> {
    const allowCreate = options.allowCreate ?? true;

    if (!this.enabled || !this.peopleService) {
      return {
        status: "skipped",
        message: this.disabledReason ?? "Google Contacts sync is not configured.",
      };
    }

    const validated = toContactData(member);
    if (!validated.valid) {
      return {
        status: "invalid",
        message: `Not added to Google Contacts - ${validated.reason}.`,
      };
    }
    const data = validated.data;

    try {
      const scan = await this.scanContacts(data.phoneE164);

      // Filling blanks on a contact that already exists adds no clutter, so it
      // is allowed regardless of the budget.
      if (scan.match) {
        return await this.fillBlanks(scan.match, data, prUrl);
      }

      // Created moments ago by this process but not yet visible to the scan.
      if (createdRecently(data.phoneE164)) {
        return {
          status: "already_exists",
          message: `${data.displayName} was just added to Google Contacts.`,
        };
      }

      // A repeat submission (an open PR already exists) must never create: if
      // the contact is not visible yet, creating would duplicate it.
      if (!allowCreate) {
        return {
          status: "skipped",
          message:
            `${data.displayName} was not added to Google Contacts - this is a ` +
            "repeat submission and the contact may already exist.",
        };
      }

      if (scan.recentlyCreated >= this.dailyLimit) {
        console.warn(
          `Google Contacts daily limit reached (${this.dailyLimit} in the last 24h); ` +
            `refusing to add ${data.displayName}.`
        );
        return {
          status: "rate_limited",
          message:
            `Not added to Google Contacts - the daily limit of ${this.dailyLimit} ` +
            "new contacts has been reached.",
        };
      }

      const response = await this.withTimeout(
        this.peopleService.people.createContact({
          personFields: PERSON_FIELDS,
          requestBody: buildContactPayload(data, prUrl),
        }),
        "createContact"
      );

      rememberCreate(data.phoneE164);

      return {
        status: "created",
        message: `Added ${data.displayName} to Google Contacts.`,
        resourceName: response.data.resourceName ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Google Contacts sync failed:", error);
      return {
        status: "failed",
        message: `Google Contacts sync failed: ${message}`,
      };
    }
  }

  /**
   * Single pass over the contact list that answers both questions we need:
   * whether this phone number is already known, and how many contacts this
   * service has created in the last 24 hours.
   *
   * `people.searchContacts` is deliberately not used for the lookup: it
   * requires a warm-up request and its index is even less current.
   *
   * Note that this call is not immune either - Google does not return a newly
   * created contact here for a minute or more. It is authoritative for
   * established contacts only, so the write-after-write window is covered
   * separately by `recentCreates` and `allowCreate`.
   *
   * Deriving the daily count from the contact list rather than from a counter
   * in memory means the budget survives restarts and holds across instances,
   * with no database to run.
   */
  private async scanContacts(
    phoneE164: string,
    now: number = Date.now()
  ): Promise<{ match: people_v1.Schema$Person | null; recentlyCreated: number }> {
    if (!this.peopleService) {
      return { match: null, recentlyCreated: 0 };
    }

    const cutoff = now - BUDGET_WINDOW_MS;
    let pageToken: string | undefined;
    let pages = 0;
    let recentlyCreated = 0;

    do {
      const response = await this.withTimeout(
        this.peopleService.people.connections.list({
          resourceName: "people/me",
          personFields: PERSON_FIELDS,
          pageSize: PAGE_SIZE,
          pageToken,
          sources: ["READ_SOURCE_TYPE_CONTACT"],
        }),
        "connections.list"
      );

      for (const person of response.data.connections ?? []) {
        const matched = (person.phoneNumbers ?? []).some((entry) =>
          phonesMatch(entry.canonicalForm ?? entry.value ?? "", phoneE164)
        );
        if (matched) {
          // An existing contact is never a new write, so the budget is moot.
          return { match: person, recentlyCreated };
        }
        if (isRecentlyCreatedByUs(person, cutoff)) {
          recentlyCreated += 1;
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken && pages < MAX_PAGES);

    if (pageToken) {
      console.warn(
        `Google Contacts scan stopped after ${MAX_PAGES} pages; ` +
          "duplicate detection may be incomplete."
      );
    }

    return { match: null, recentlyCreated };
  }

  /**
   * Add only the fields the existing contact is missing. Existing values are
   * left exactly as they are, and `updatePersonFields` is limited to the
   * fields actually being written so nothing else can be clobbered.
   */
  private async fillBlanks(
    existing: people_v1.Schema$Person,
    data: NormalizedContactData,
    prUrl?: string
  ): Promise<GoogleContactSyncResult> {
    // A contact can only be updated with both an id and its etag. Without them
    // the safe move is to leave it alone - never to create a second contact.
    if (!existing.resourceName || !existing.etag) {
      return {
        status: "already_exists",
        message: `${data.displayName} is already in Google Contacts.`,
        resourceName: existing.resourceName ?? undefined,
      };
    }

    const existingName = existing.names?.[0];
    const hasName = Boolean(
      existingName?.displayName?.trim() || existingName?.givenName?.trim()
    );
    const hasOrganization = (existing.organizations ?? []).some((org) =>
      Boolean(org.name?.trim() || org.title?.trim())
    );
    const hasBiography = (existing.biographies ?? []).some((bio) =>
      Boolean(bio.value?.trim())
    );

    const existingUrls = existing.urls ?? [];
    const knownUrls = new Set(
      existingUrls.map((url) => normalizeUrlForCompare(url.value ?? ""))
    );
    const newUrls = [
      data.githubUrl ? { value: data.githubUrl, type: "GitHub" } : null,
      data.linkedinUrl ? { value: data.linkedinUrl, type: "LinkedIn" } : null,
    ].filter(
      (url): url is { value: string; type: string } =>
        Boolean(url) && !knownUrls.has(normalizeUrlForCompare(url!.value))
    );

    const requestBody: people_v1.Schema$Person = { etag: existing.etag };
    const updateFields: string[] = [];
    const filled: string[] = [];

    if (!hasName) {
      requestBody.names = [
        {
          displayName: data.displayName,
          givenName: data.givenName,
          familyName: data.familyName,
        },
      ];
      updateFields.push("names");
      filled.push("name");
    }

    if (!hasOrganization && (data.company || data.role)) {
      requestBody.organizations = [{ name: data.company, title: data.role }];
      updateFields.push("organizations");
      filled.push("organisation");
    }

    if (newUrls.length > 0) {
      // The People API replaces the whole field, so resend the existing URLs.
      requestBody.urls = [...existingUrls, ...newUrls];
      updateFields.push("urls");
      filled.push(...newUrls.map((url) => url.type));
    }

    const notes = buildNotes(data, prUrl);
    if (!hasBiography && notes) {
      requestBody.biographies = [{ value: notes, contentType: "TEXT_PLAIN" }];
      updateFields.push("biographies");
      filled.push("notes");
    }

    if (updateFields.length === 0) {
      return {
        status: "already_exists",
        message: `${data.displayName} is already in Google Contacts - nothing to add.`,
        resourceName: existing.resourceName ?? undefined,
      };
    }

    const response = await this.withTimeout(
      this.peopleService!.people.updateContact({
        resourceName: existing.resourceName,
        updatePersonFields: updateFields.join(","),
        personFields: PERSON_FIELDS,
        requestBody,
      }),
      "updateContact"
    );

    return {
      status: "enriched",
      message:
        `${data.displayName} was already in Google Contacts; ` +
        `filled in ${filled.join(", ")}.`,
      resourceName: response.data.resourceName ?? existing.resourceName,
      filled,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, operationName: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Google Contacts ${operationName} timed out after ${this.requestTimeoutMs}ms`
          )
        );
      }, this.requestTimeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

function buildNotes(data: NormalizedContactData, prUrl?: string): string {
  return [
    CONTACT_MARKER,
    data.refererName ? `Referred by: ${data.refererName}` : null,
    prUrl ? `PR: ${prUrl}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildContactPayload(
  data: NormalizedContactData,
  prUrl?: string
): people_v1.Schema$Person {
  const urls = [
    data.githubUrl ? { value: data.githubUrl, type: "GitHub" } : null,
    data.linkedinUrl ? { value: data.linkedinUrl, type: "LinkedIn" } : null,
  ].filter((url): url is { value: string; type: string } => Boolean(url));

  const notes = buildNotes(data, prUrl);

  const person: people_v1.Schema$Person = {
    names: [
      {
        displayName: data.displayName,
        givenName: data.givenName,
        familyName: data.familyName,
      },
    ],
    phoneNumbers: [{ value: data.phoneE164, type: "mobile" }],
  };

  if (data.company || data.role) {
    person.organizations = [{ name: data.company, title: data.role }];
  }
  if (urls.length > 0) {
    person.urls = urls;
  }
  if (notes) {
    person.biographies = [{ value: notes, contentType: "TEXT_PLAIN" }];
  }

  return person;
}

/** Compare URLs ignoring scheme, `www.`, trailing slash and case. */
function normalizeUrlForCompare(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * True when this contact was created by us and last touched inside the budget
 * window. Contacts with no usable timestamp are not counted: a fresh write from
 * the People API always carries one, so an undated contact is an old one, and
 * counting it would block legitimate joins.
 */
function isRecentlyCreatedByUs(
  person: people_v1.Schema$Person,
  cutoff: number
): boolean {
  const isOurs = (person.biographies ?? []).some((bio) =>
    (bio.value ?? "").includes(CONTACT_MARKER)
  );
  if (!isOurs) {
    return false;
  }

  return (person.metadata?.sources ?? []).some((source) => {
    const updatedAt = source.updateTime ? Date.parse(source.updateTime) : NaN;
    return Number.isFinite(updatedAt) && updatedAt >= cutoff;
  });
}

function resolvePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function resolveTimeoutMs(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}
