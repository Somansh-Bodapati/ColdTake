// GET /api/groups/by-code/:code — public join-preview lookup (this
// session's brief, task 6): no auth, no member data, just enough for the
// /join landing page to show a name before signing in.

import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, user } from "@/lib/db/schema";
import { createAnonymousUser } from "@/lib/auth/session";
import { createGroup } from "@/lib/groups/service";
import handler from "./[code]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

afterEach(async () => {
  if (createdGroupIds.length > 0) {
    await db.delete(group).where(inArray(group.id, createdGroupIds));
    createdGroupIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function previewRequest(code: string): Request {
  return new Request(`http://localhost/api/groups/by-code/${encodeURIComponent(code)}`, { method: "GET" });
}

describe("GET /api/groups/by-code/:code", () => {
  it("returns the group's id and name for a valid code, unauthenticated", async () => {
    const { userId } = await createAnonymousUser(db, "Admin");
    createdUserIds.push(userId);
    const created = await createGroup(db, { name: "Preview Test Group", creatorUserId: userId });
    createdGroupIds.push(created.id);

    const response = await handler(previewRequest(created.joinCode));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; name: string };
    expect(body).toEqual({ id: created.id, name: "Preview Test Group" });
  });

  it("404s for an unknown code", async () => {
    const response = await handler(previewRequest("ZZZZZZ"));
    expect(response.status).toBe(404);
  });

  it("404s for a malformed code instead of hitting the DB with garbage", async () => {
    const response = await handler(previewRequest("not-a-code!"));
    expect(response.status).toBe(404);
  });
});
