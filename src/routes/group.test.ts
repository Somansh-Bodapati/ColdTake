// Bug fix (tonight): clicking a draft-status season from the group page did
// nothing — seasonLinkPath returned null for "draft" unconditionally, so
// the list rendered inert "Not published yet" text instead of a link, and
// there was no route that could have made sense of a draft anyway
// (season-picks.tsx is for open/post-publish seasons, reveal/standings are
// for locked/settled/voided). season-new.tsx now has an edit mode at
// /groups/:groupId/seasons/:seasonId/edit (src/routes.ts) for loading an
// existing draft, so this asserts every status routes where it actually
// should, including the new admin-only draft case.

import { describe, expect, it } from "vitest";
import { seasonLinkPath } from "./group";
import type { GroupSeasonSummary } from "@/lib/schemas/groups";

function season(status: GroupSeasonSummary["status"]): GroupSeasonSummary {
  return { id: "season-1", name: "IPL 2026", status, lockAt: "2026-03-27T19:00:00.000Z" };
}

describe("seasonLinkPath", () => {
  it("routes a draft season to the edit flow for a group admin", () => {
    expect(seasonLinkPath("group-1", season("draft"), true)).toBe(
      "/groups/group-1/seasons/season-1/edit"
    );
  });

  it("does not link a draft season for a non-admin member", () => {
    expect(seasonLinkPath("group-1", season("draft"), false)).toBeNull();
  });

  it("routes an open season to the pick sheet", () => {
    expect(seasonLinkPath("group-1", season("open"), false)).toBe(
      "/groups/group-1/seasons/season-1/picks"
    );
  });

  it("routes locked and settled seasons to the reveal page", () => {
    expect(seasonLinkPath("group-1", season("locked"), false)).toBe(
      "/groups/group-1/seasons/season-1/reveal"
    );
    expect(seasonLinkPath("group-1", season("settled"), false)).toBe(
      "/groups/group-1/seasons/season-1/reveal"
    );
  });

  it("routes a voided season to standings", () => {
    expect(seasonLinkPath("group-1", season("voided"), false)).toBe(
      "/groups/group-1/seasons/season-1/standings"
    );
  });
});
