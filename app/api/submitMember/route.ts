import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "../../../lib/validation";
import { verifyRequest } from "../../../lib/authorization";
import { GitHubService } from "../../../lib/github";
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

export const POST = async (request: Request) => {
  const [, authResponse] = await verifyRequest(request);
  if (authResponse) {
    return authResponse;
  }

  const validation = await validateBody(request, submitMemberSchema);
  if (!validation.success) {
    return validation.response;
  }

  const memberData = validation.data;
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
    return NextResponse.json(
      {
        status: "success",
        message: `The CUSTOMER is already a member of the community!`,
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
    return NextResponse.json(result);
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