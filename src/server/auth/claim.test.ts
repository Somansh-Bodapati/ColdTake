import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../../lib/db/client";
import { user } from "../../lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { createId } from "../../lib/db/id";
import handler from "./claim";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function claimRequest(rawToken: string | null, email: unknown): Request {
  return new Request("http://localhost/api/auth/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/auth/claim", () => {
  it("requires a session", async () => {
    const response = await handler(claimRequest(null, "someone@example.com"));
    expect(response.status).toBe(401);
  });

  it("returns a magic-link token/url instead of emailing it (no provider wired up yet)", async () => {
    const { userId, session } = await createAnonymousUser(db, "Wants Email");
    createdUserIds.push(userId);
    const email = `claim-${createId()}@example.com`;

    const response = await handler(claimRequest(session.rawToken, email));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { claimUrl: string; token: string; expiresAt: string };
    expect(body.token).toBeTruthy();
    expect(body.claimUrl).toContain(encodeURIComponent(body.token));
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects an invalid email with 400", async () => {
    const { userId, session } = await createAnonymousUser(db, "Bad Email");
    createdUserIds.push(userId);

    const response = await handler(claimRequest(session.rawToken, "not-an-email"));
    expect(response.status).toBe(400);
  });
});
