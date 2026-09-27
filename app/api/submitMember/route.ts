import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "../../../lib/validation";
import { verifyRequest } from "../../../lib/authorization";
import { GitHubService } from "../../../lib/github";
import { GoogleContactsService } from "../../../lib/googleContacts";
import { checkOverallRate, checkPhoneRate, type RateLimitDecision } from "../../../lib/rateLimit";
import { Member } from "@/types/membersdb";

export const submitMemberSchema = z.object({
  name: z.string().nonempty(),
  role: z.string().nonempty(),
  github: z.string().nonempty(),
  company: z.string().nonempty(),
  linkedin: z.string().nonempty(),
  phone_e164: z.string().nonempty(),
  referer_name: z.string().nonempty(),
});

type SubmitMemberInput = z.infer<typeof submitMemberSchema>;

/** 429 with the retry window, phrased so the agent can relay it as-is. */
const rateLimited = (decision: RateLimitDecision, detail: string) =>
  NextResponse.json(
    {
      status: "error",
      message:
        `Too many join requests ${detail}. Try again in ` +
        `${decision.retryAfterSeconds} seconds.`,
    },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
  );

/**
 * Add the member to Google Contacts. Deduplicated on phone number, and never
 * overwrites data already on an existing contact.
 *
 * Failures here are reported but never block the member's join request.
 */
const syncContact = async (
  memberData: SubmitMemberInput,
  prUrl?: string,
  options: { allowCreate?: boolean } = {}
) => {
  const contacts = new GoogleContactsService();
  return contacts.syncMemberContact(
    {
      name: memberData.name,
      phone: memberData.phone_e164,
      company: memberData.company,
      role: memberData.role,
      github: memberData.github,
      linkedin: memberData.linkedin,
      refererName: memberData.referer_name,
    },
    prUrl,
    options
  );
};

export const POST = async (request: Request) => {
  const [, authResponse] = await verifyRequest(request);
  if (authResponse) {
    return authResponse;
  }

  // Checked before the body is parsed, so a flood cannot cost us GitHub or
  // Google calls. Authenticated requests only - a rejected caller can never
  // consume the budget.
  const overall = checkOverallRate();
  if (!overall.allowed) {
    console.warn("submitMember rate limit hit (overall)");
    return rateLimited(overall, "right now");
  }

  const validation = await validateBody(request, submitMemberSchema);
  if (!validation.success) {
    return validation.response;
  }

  const memberData = validation.data;

  const perPhone = checkPhoneRate(memberData.phone_e164);
  if (!perPhone.allowed) {
    console.warn("submitMember rate limit hit (per phone)");
    return rateLimited(perPhone, "for this phone number");
  }
  const githubService = new GitHubService();

  // Check if GitHub user exists
  const userExists = await githubService.checkGitHubUser(memberData.github);
  if (!userExists) {
    return NextResponse.json(
      {
        status: "error",
        message: `GitHub user '${memberData.github}' not found - ask the CUSTOMER to provide a valid GitHub username`,
      },
      { status: 400 }
    );
  }

  const existingMember = await githubService.getMemberByPhone(memberData.phone_e164);
  if (existingMember) {
    // Already in members.yaml, but they may still be missing from Contacts.
    const googleContacts = await syncContact(memberData);
    return NextResponse.json(
      {
        status: "success",
        message: `The CUSTOMER is already a member of the community!`,
        google_contacts: googleContacts,
      },
      { status: 200 }
    );
  }

  try {
    const member = {
      name: memberData.name,
      phone: memberData.phone_e164,
      current_job: {
        role: memberData.role,
        company: memberData.company,
      },
      social: {
        github: memberData.github,
        linkedin: memberData.linkedin || undefined,
      },
      referer_name: memberData.referer_name || undefined,
    } as Member;

    const result = await githubService.createMemberPR(member);

    // An already-open PR means we have seen this person before and almost
    // certainly synced them already. Google needs a minute before a new contact
    // shows up in a scan, so allowing a create here would duplicate it.
    const googleContacts = await syncContact(memberData, result.pr_url, {
      allowCreate: result.status !== "pr_exists",
    });

    return NextResponse.json({ ...result, google_contacts: googleContacts });
  } catch (error) {
    console.error("Failed to create PR:", error);
    return NextResponse.json(
      {
        status: "error",
        message: `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
};
