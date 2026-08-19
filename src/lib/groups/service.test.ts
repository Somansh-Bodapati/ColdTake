// Integration test against the local Postgres, same pattern as
// src/lib/auth/session.test.ts. Session 16's cost audit: requireMembership
// sits underneath nearly every group- and season-scoped read (CLAUDE.md
// rule 2, "the database is expensive") — this locks in both its 404/403/200
// behavior and the single-query round trip the audit's fix collapsed it to
// (previously two separate selects: "does the group exist", then "is this
// user an active member").

import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { db } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { createAnonymousUser } from "@/lib/auth/session";
import { createGroup, requireMembership } from "@/lib/groups/service";
import { cleanupSeasonFixtures } from "@/lib/seasons/test-support";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, []);
});

describe("requireMembership", () => {
  it("returns the caller's memberId/role for an active member", async () => {
    const { userId } = await createAnonymousUser(db, "Admin");
    createdUserIds.push(userId);
    const created = await createGroup(db, { name: "Membership Test", creatorUserId: userId });
    createdGroupIds.push(created.id);

    const result = await requireMembership(db, created.id, userId);
    expect(result.role).toBe("admin");
  });

  it("throws 404 when the group doesn't exist", async () => {
    const { userId } = await createAnonymousUser(db, "Someone");
    createdUserIds.push(userId);

    await expect(requireMembership(db, "does-not-exist", userId)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<AppError>);
  });

  it("throws 403 when the group exists but the caller isn't a member", async () => {
    const { userId: ownerId } = await createAnonymousUser(db, "Owner");
    createdUserIds.push(ownerId);
    const created = await createGroup(db, { name: "Not Yours", creatorUserId: ownerId });
    createdGroupIds.push(created.id);

    const { userId: outsiderId } = await createAnonymousUser(db, "Outsider");
    createdUserIds.push(outsiderId);

    await expect(requireMembership(db, created.id, outsiderId)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<AppError>);
  });

  it("costs exactly one SQL round trip, not one per exists-check", async () => {
    const { userId } = await createAnonymousUser(db, "Admin");
    createdUserIds.push(userId);
    const created = await createGroup(db, { name: "Single Query", creatorUserId: userId });
    createdGroupIds.push(created.id);

    let count = 0;
    const originalQuery = Pool.prototype.query;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Pool.prototype as any).query = function (...args: unknown[]) {
      count += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalQuery as any).apply(this, args);
    };
    try {
      await requireMembership(db, created.id, userId);
    } finally {
      Pool.prototype.query = originalQuery;
    }

    expect(count).toBe(1);
  });
});
