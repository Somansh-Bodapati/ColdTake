import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { findOrCreateGoogleUser, needsNamePrompt } from "@/lib/auth/google";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createId } from "@/lib/db/id";
import handler from "./confirm-name";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function confirmRequest(rawToken: string | null, body: unknown): Request {
  return new Request("http://localhost/api/auth/confirm-name", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/confirm-name", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(confirmRequest(null, { displayName: "Someone" }));
    expect(response.status).toBe(401);
  });

  it("rejects an empty display name with 400", async () => {
    const result = await findOrCreateGoogleUser(db, {
      sub: `google-${createId()}`,
      email: `confirm-${createId()}@example.com`,
      email_verified: true,
      given_name: "Placeholder",
    });
    createdUserIds.push(result.userId);

    const response = await handler(confirmRequest(result.session.rawToken, { displayName: "" }));
    expect(response.status).toBe(400);
  });

  it("sets the display name and clears the need for the prompt", async () => {
    const result = await findOrCreateGoogleUser(db, {
      sub: `google-${createId()}`,
      email: `confirm2-${createId()}@example.com`,
      email_verified: true,
      given_name: "Placeholder",
    });
    createdUserIds.push(result.userId);
    expect(needsNamePrompt(result.displayNameConfirmedAt)).toBe(true);

    const response = await handler(confirmRequest(result.session.rawToken, { displayName: "Real Name" }));
    expect(response.status).toBe(200);

    const [row] = await db.select().from(user).where(eq(user.id, result.userId)).limit(1);
    expect(row?.displayName).toBe("Real Name");
    expect(needsNamePrompt(row?.displayNameConfirmedAt ?? null)).toBe(false);
  });
});
