import { NextResponse } from "next/server";
import { z } from "zod";

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export async function validateBody<T extends z.ZodSchema>(
  request: Request,
  schema: T
): Promise<ValidationResult<z.infer<T>>> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);

  if (!result.success) {
    const errors = result.error.issues.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));

    return {
      success: false,
      response: NextResponse.json(
        { error: "Validation failed", details: errors },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: result.data };
  }
  catch (error) {
    return { success: false, response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}
