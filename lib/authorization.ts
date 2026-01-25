import { NextResponse } from "next/server";

export const verifyRequest = async (request: Request): Promise<[boolean, NextResponse | null]> => {
    const authorization = request.headers.get("Authorization");
    if (!authorization) {
        return [false, NextResponse.json({ error: "Unauthorized" }, { status: 401 })];
    }
    const [type, token] = authorization.split(" ");
    if (type !== "Bearer") {
        return [false, NextResponse.json({ error: "Unauthorized" }, { status: 401 })];
    }
    if (token !== process.env.BIG_TONY_API_KEY) {
        return [false, NextResponse.json({ error: "Unauthorized" }, { status: 401 })];
    }
    return [true, null];
};