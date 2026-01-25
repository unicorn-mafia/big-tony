import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "../../../lib/validation";
import { verifyRequest } from "../../../lib/authorization";
import { GitHubService } from "../../../lib/github";

export const checkMemberSchema = z.object({
  phone_e164: z.string(),
});

export const POST = async (request: Request) => {
  const [, authResponse] = await verifyRequest(request);
  if (authResponse) {
    return authResponse;
  }
  const validation = await validateBody(request, checkMemberSchema);
  if (!validation.success) {
    return validation.response;
  }

  const {phone_e164} = validation.data;
  const githubService = new GitHubService();

  try {
    const result = await githubService.getMemberByPhone(phone_e164);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to check member:", error);
    return NextResponse.json(
      {
        status: "error",
        message: `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
};