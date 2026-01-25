import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "../../../lib/validation";
import { verifyRequest } from "../../../lib/authorization";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const submitDemoSchema = z.object({
  title: z.string(),
  demoPitch: z.string(),
  videoUrl: z.string().optional(),
  phoneNumber: z.string(),
});

export const POST = async (request: Request) => {
  const [, authResponse] = await verifyRequest(request);
  if (authResponse) {
    return authResponse;
  }
  const validation = await validateBody(request, submitDemoSchema);
  if (!validation.success) {
    return validation.response;
  }

  const {title, demoPitch, videoUrl, phoneNumber} = validation.data;

  try {
    const result = await resend.emails.send({
      from: `Big Tony <${process.env.RESEND_FROM_EMAIL!}>`,
      to: process.env.DEMO_EMAIL_RECIPIENT!,
      subject: `New demo submitted: ${title}`,
      html: `
        <p>New demo submitted by <a href="tel:${phoneNumber}">${phoneNumber}</a>:</p>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Demo pitch:</strong> ${demoPitch}</p>
        ${videoUrl ? `<p><strong>Video URL:</strong> ${videoUrl}</p>` : ''}
        <p>Lots of love,</p>
        <p>Big Tony</p>
      `,
    });
    if (result.error) {
      return NextResponse.json(
        {
          status: "error",
          message: `Failed to submit demo! Please try again later.`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      status: "success",
      message: `Demo submitted successfully!`,
    }, { status: 200 });
  } catch (error) {
    console.error("Failed to submit demo:", error);
    return NextResponse.json(
      {
        status: "error",
        message: `Failed to submit demo! Please try again later.`,
      },
      { status: 500 }
    );
  }
};