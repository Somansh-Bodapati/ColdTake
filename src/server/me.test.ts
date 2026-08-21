import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import handler from "./me";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function meRequest(rawToken: string | null): Request {
  return new Request("http://localhost/api/me", {
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/me", () => {
  it("returns the current user and their groups (none yet)", async () => {
    const { userId, session } = await createAnonymousUser(db, "Me Test");
    createdUserIds.push(userId);

    const response = await handler(meRequest(session.rawToken));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      user: { id: string; displayName: string };
      groups: unknown[];
    };
    expect(body.user.id).toBe(userId);
    expect(body.user.displayName).toBe("Me Test");
    expect(body.groups).toEqual([]);
  });

  it("returns 401 with no session", async () => {
    const response = await handler(meRequest(null));
    expect(response.status).toBe(401);
  });
});
