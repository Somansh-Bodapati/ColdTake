import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createAnonymousUser, requireUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import handler from "./logout";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function cookieRequest(rawToken: string | null, path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("POST /api/auth/logout", () => {
  it("revokes the session so requireUser rejects it afterwards", async () => {
    const { userId, session } = await createAnonymousUser(db, "Logging Out");
    createdUserIds.push(userId);

    const response = await handler(cookieRequest(session.rawToken, "/api/auth/logout"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    await expect(
      requireUser(db, cookieRequest(session.rawToken, "/api/me"))
    ).rejects.toBeInstanceOf(AppError);
  });

  it("is a no-op (still 200) with no session cookie", async () => {
    const response = await handler(cookieRequest(null, "/api/auth/logout"));
    expect(response.status).toBe(200);
  });
});
