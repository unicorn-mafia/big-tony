import { google, people_v1 } from "googleapis";

import type { Member } from "../types/membersdb";

export interface GoogleContactSyncResult {
  status: "created" | "updated" | "skipped" | "failed";
  message: string;
  resourceName?: string;
}

interface ExistingContact {
  resourceName: string;
  etag: string;
}

export class GoogleContactsService {
  private peopleService?: people_v1.People;
  private enabled: boolean;
  private requestTimeoutMs: number;

  constructor() {
    this.requestTimeoutMs = this.resolveTimeoutMs(process.env.GOOGLE_CONTACTS_TIMEOUT_MS);

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      this.enabled = false;
      return;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    this.peopleService = google.people({ version: "v1", auth: oauth2Client });
    this.enabled = true;
  }

  async syncMemberContact(member: Member, prUrl?: string): Promise<GoogleContactSyncResult> {
    if (!this.enabled || !this.peopleService) {
      return {
        status: "skipped",
        message: "Google Contacts integration is not configured.",
      };
    }

    const contactPayload = this.buildContactPayload(member, prUrl);

    try {
      const existingContact = await this.findContactByPhone(member.phone);
      if (existingContact) {
        const response = await this.withTimeout(
          this.peopleService.people.updateContact({
            resourceName: existingContact.resourceName,
            updatePersonFields: "names,phoneNumbers,organizations,urls,biographies",
            personFields: "names,phoneNumbers,organizations,urls,biographies",
            requestBody: {
              ...contactPayload,
              etag: existingContact.etag,
            },
          }),
          "updateContact"
        );

        return {
          status: "updated",
          message: `Updated ${member.name} in Google Contacts.`,
          resourceName: response.data.resourceName ?? existingContact.resourceName,
        };
      }

      const response = await this.withTimeout(
        this.peopleService.people.createContact({
          requestBody: contactPayload,
        }),
        "createContact"
      );

      return {
        status: "created",
        message: `Added ${member.name} to Google Contacts.`,
        resourceName: response.data.resourceName ?? undefined,
      };
    } catch (error) {
      return {
        status: "failed",
        message: `Google Contacts sync failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async findContactByPhone(phoneNumber: string): Promise<ExistingContact | null> {
    if (!this.peopleService) {
      return null;
    }

    const sanitizedPhone = this.normalizePhone(phoneNumber);
    if (!sanitizedPhone) {
      return null;
    }

    const response = await this.withTimeout(
      this.peopleService.people.searchContacts({
        query: sanitizedPhone,
        readMask: "names,phoneNumbers,etag",
        pageSize: 10,
      }),
      "searchContacts"
    );

    const results = response.data.results ?? [];
    for (const result of results) {
      const person = result.person;
      if (!person?.resourceName || !person.etag) {
        continue;
      }

      const matchedPhone = (person.phoneNumbers ?? []).some((item) => {
        const candidate = this.normalizePhone(item.canonicalForm ?? item.value ?? "");
        return candidate === sanitizedPhone;
      });

      if (matchedPhone) {
        return {
          resourceName: person.resourceName,
          etag: person.etag,
        };
      }
    }

    return null;
  }

  private buildContactPayload(member: Member, prUrl?: string): people_v1.Schema$Person {
    const [givenName, ...rest] = member.name.trim().split(/\s+/);
    const familyName = rest.join(" ");

    const urls = [
      { value: member.social.github, type: "profile" },
      member.social.linkedin ? { value: member.social.linkedin, type: "profile" } : null,
    ].filter((entry): entry is { value: string; type: string } => Boolean(entry));

    const notes = [
      "Source: unicorn mafia onboarding",
      member.referer_name ? `Referred by: ${member.referer_name}` : null,
      prUrl ? `PR: ${prUrl}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join("\n");

    return {
      names: [
        {
          displayName: member.name,
          givenName,
          familyName: familyName || undefined,
        },
      ],
      phoneNumbers: [
        {
          value: member.phone,
          type: "mobile",
        },
      ],
      organizations: [
        {
          name: member.current_job.company,
          title: member.current_job.role,
        },
      ],
      urls,
      biographies: notes
        ? [
            {
              value: notes,
              contentType: "TEXT_PLAIN",
            },
          ]
        : undefined,
    };
  }

  private normalizePhone(phoneNumber: string): string {
    const trimmed = phoneNumber.trim();
    if (!trimmed) {
      return "";
    }

    if (trimmed.startsWith("+")) {
      return `+${trimmed.slice(1).replace(/\D/g, "")}`;
    }

    return trimmed.replace(/\D/g, "");
  }

  private resolveTimeoutMs(rawValue: string | undefined): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 5000;
    }

    return parsed;
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
