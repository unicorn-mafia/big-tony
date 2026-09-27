/**
 * Live smoke test for the Google Contacts sync.
 *
 *   npm run test:contacts:live -- --confirm
 *
 * Unlike `npm run test:contacts`, this talks to the real People API and WRITES A
 * REAL CONTACT to the Google account behind GOOGLE_REFRESH_TOKEN. It needs only
 * the three GOOGLE_* variables - no GitHub or Resend credentials - so it can be
 * run before the rest of the environment is set up.
 *
 * Run it twice: the second run should report `already_exists` or `enriched`,
 * which proves deduplication works against live data.
 *
 * The test number is in Ofcom's reserved-for-drama range, so it can never reach
 * a real person.
 */
import { GoogleContactsService } from "../lib/googleContacts";

const TEST_MEMBER = {
  name: "Big Tony Smoke Test",
  phone: "+447700900999",
  company: "Delete Me Ltd",
  role: "Test Contact",
  github: "octocat",
  linkedin: "https://www.linkedin.com/in/big-tony-smoke-test",
  refererName: "Smoke test",
};

if (!process.argv.includes("--confirm")) {
  console.error(
    [
      "",
      "This writes a real contact to your Google account.",
      "",
      `  Name:  ${TEST_MEMBER.name}`,
      `  Phone: ${TEST_MEMBER.phone}`,
      "",
      "Re-run with --confirm to go ahead:",
      "",
      "  npm run test:contacts:live -- --confirm",
      "",
      "Afterwards, delete the contact by hand at contacts.google.com - this app",
      "has no ability to delete contacts, by design.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const service = new GoogleContactsService();

if (!service.isEnabled) {
  console.error(
    "Sync is not enabled. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and\n" +
      "GOOGLE_REFRESH_TOKEN are set, and that GOOGLE_CONTACTS_SYNC_ENABLED is not\n" +
      '"false".'
  );
  process.exit(1);
}

console.log(`Syncing ${TEST_MEMBER.name} (${TEST_MEMBER.phone}) ...\n`);

const result = await service.syncMemberContact(
  TEST_MEMBER,
  "https://github.com/unicorn-mafia/members-db/pull/0"
);

console.log(`  status:       ${result.status}`);
console.log(`  message:      ${result.message}`);
if (result.resourceName) {
  console.log(`  resourceName: ${result.resourceName}`);
}
if (result.filled) {
  console.log(`  filled:       ${result.filled.join(", ")}`);
}
console.log("");

switch (result.status) {
  case "created":
    console.log("Live path works. Check contacts.google.com, then delete the test contact.");
    console.log("Run this again to confirm it is not added a second time.");
    break;
  case "already_exists":
  case "enriched":
    console.log("Deduplication works - the existing contact was matched, not duplicated.");
    console.log("Delete the test contact at contacts.google.com when you are done.");
    break;
  case "skipped":
  case "invalid":
  case "rate_limited":
    console.log("Nothing was written. See the message above.");
    break;
  case "failed":
    console.error("The live call failed. The message above is the error from Google.");
    process.exit(1);
}
