import { GoogleContactsService } from "../lib/googleContacts";
import type { Member } from "../types/membersdb";

type PeopleResult = {
  person?: {
    resourceName?: string;
    etag?: string;
    phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>;
  };
};

type FakePeopleApi = {
  searchContacts: (args: unknown) => Promise<{ data: { results?: PeopleResult[] } }>;
  updateContact: (args: unknown) => Promise<{ data: { resourceName?: string } }>;
  createContact: (args: unknown) => Promise<{ data: { resourceName?: string } }>;
};

const originalSetTimeout = global.setTimeout;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sampleMember(): Member {
  return {
    name: "Ada Lovelace",
    phone: "+447700900123",
    current_job: {
      role: "Engineer",
      company: "Analytical Engines Ltd",
    },
    social: {
      github: "https://github.com/adal",
      linkedin: "https://linkedin.com/in/ada",
    },
    referer_name: "Charles",
  };
}

function createServiceWithFakePeople(fakePeople: FakePeopleApi): GoogleContactsService {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REFRESH_TOKEN = "test-refresh-token";
  process.env.GOOGLE_CONTACTS_TIMEOUT_MS = "20";

  const service = new GoogleContactsService();
  (service as unknown as { peopleService?: { people: FakePeopleApi } }).peopleService = {
    people: fakePeople,
  };
  (service as unknown as { enabled?: boolean }).enabled = true;
  return service;
}

async function testSkipWhenNotConfigured(): Promise<void> {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CONTACTS_TIMEOUT_MS;

  const service = new GoogleContactsService();
  const result = await service.syncMemberContact(sampleMember(), "https://example.com/pr/1");

  assert(result.status === "skipped", "Expected skipped when Google creds are missing");
}

async function testCreateWhenNoExistingContact(): Promise<void> {
  let createCalled = false;
  const service = createServiceWithFakePeople({
    searchContacts: async () => ({ data: { results: [] } }),
    updateContact: async () => ({ data: {} }),
    createContact: async () => {
      createCalled = true;
      return { data: { resourceName: "people/new-contact" } };
    },
  });

  const result = await service.syncMemberContact(sampleMember(), "https://example.com/pr/2");
  assert(createCalled, "Expected createContact to be called");
  assert(result.status === "created", "Expected created status when no contact exists");
}

async function testUpdateWhenExistingContact(): Promise<void> {
  let updateCalled = false;
  const service = createServiceWithFakePeople({
    searchContacts: async () => ({
      data: {
        results: [
          {
            person: {
              resourceName: "people/existing",
              etag: "etag123",
              phoneNumbers: [{ canonicalForm: "+447700900123" }],
            },
          },
        ],
      },
    }),
    updateContact: async () => {
      updateCalled = true;
      return { data: { resourceName: "people/existing" } };
    },
    createContact: async () => ({ data: {} }),
  });

  const result = await service.syncMemberContact(sampleMember(), "https://example.com/pr/3");
  assert(updateCalled, "Expected updateContact to be called");
  assert(result.status === "updated", "Expected updated status for existing contact");
}

async function testTimeoutPath(): Promise<void> {
  const service = createServiceWithFakePeople({
    searchContacts: async () => new Promise(() => undefined),
    updateContact: async () => ({ data: {} }),
    createContact: async () => ({ data: {} }),
  });

  const result = await service.syncMemberContact(sampleMember(), "https://example.com/pr/4");
  assert(result.status === "failed", "Expected failed status when API times out");
  assert(
    result.message.includes("timed out"),
    "Expected timeout message when API does not resolve"
  );
}

async function run(): Promise<void> {
  await testSkipWhenNotConfigured();
  await testCreateWhenNoExistingContact();
  await testUpdateWhenExistingContact();
  await testTimeoutPath();
}

run()
  .then(() => {
    console.log("googleContacts service tests passed");
  })
  .catch((error) => {
    console.error("googleContacts service tests failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.setTimeout = originalSetTimeout;
  });
