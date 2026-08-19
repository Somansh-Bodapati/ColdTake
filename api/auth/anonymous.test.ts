import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import handler from "./anonymous";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/anonymous", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/anonymous", () => {
  it("creates a user, sets a session cookie, and returns the token", async () => {
    const response = await handler(postRequest({ displayName: "Rahul" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { userId: string; sessionToken: string };
    createdUserIds.push(body.userId);
    expect(body.userId).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects an empty display name with 400", async () => {
    const response = await handler(postRequest({ displayName: "" }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-POST method with 405", async () => {
    const response = await handler(new Request("http://localhost/api/auth/anonymous"));
    expect(response.status).toBe(405);
  });
});
