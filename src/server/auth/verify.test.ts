import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createAnonymousUser, createClaimToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createId } from "@/lib/db/id";
import handler from "./verify";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function verifyRequest(token: unknown): Request {
  return new Request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/auth/verify", () => {
  it("consumes a claim token, attaches the email, and issues a session cookie", async () => {
    const { userId } = await createAnonymousUser(db, "Verifier");
    createdUserIds.push(userId);
    const email = `verify-${createId()}@example.com`;
    const claim = await createClaimToken(db, userId, email);

    const response = await handler(verifyRequest(claim.rawToken));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { userId: string; sessionToken: string };
    expect(body.userId).toBe(userId);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
  });

  it("returns 400 for an unknown token", async () => {
    const response = await handler(verifyRequest("bogus-token"));
    expect(response.status).toBe(400);
  });
});
