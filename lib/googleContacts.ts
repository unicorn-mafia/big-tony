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

/** Fields we read when scanning for an existing contact and when merging. */
const PERSON_FIELDS = "names,phoneNumbers,organizations,urls,biographies";

const DEFAULT_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 25; // 25k contacts; guards against an unbounded scan.

export class GoogleContactsService {
  private peopleService?: people_v1.People;
  private enabled: boolean;
  private requestTimeoutMs: number;

  constructor() {
    this.requestTimeoutMs = resolveTimeoutMs(process.env.GOOGLE_CONTACTS_TIMEOUT_MS);

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      this.enabled = false;
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
    prUrl?: string
  ): Promise<GoogleContactSyncResult> {
    if (!this.enabled || !this.peopleService) {
      return {
        status: "skipped",
        message: "Google Contacts sync is not configured.",
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
      const existing = await this.findContactByPhone(data.phoneE164);

      if (existing) {
        return await this.fillBlanks(existing, data, prUrl);
      }

      const response = await this.withTimeout(
        this.peopleService.people.createContact({
          personFields: PERSON_FIELDS,
          requestBody: buildContactPayload(data, prUrl),
        }),
        "createContact"
      );

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
   * Scan the full contact list for a matching phone number.
   *
   * `people.searchContacts` is deliberately not used: it requires a warm-up
   * request and its index is only eventually consistent, so a contact added
   * moments ago can be missed - which would create a duplicate.
   */
  private async findContactByPhone(
    phoneE164: string
  ): Promise<people_v1.Schema$Person | null> {
    if (!this.peopleService) {
      return null;
    }

    let pageToken: string | undefined;
    let pages = 0;

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
          return person;
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

    return null;
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
    "Source: Unicorn Mafia onboarding (Big Tony)",
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

function resolveTimeoutMs(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}
