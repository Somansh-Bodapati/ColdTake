import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("join", "routes/join.tsx"),
  route("groups/:groupId", "routes/group.tsx"),
  route("groups/:groupId/seasons/new", "routes/season-new.tsx"),
  // Same component as above, in edit mode (season-new.tsx branches on
  // whether :seasonId is present) — needs an explicit `id` since two
  // `route()` entries can't otherwise share one file's default route id.
  route("groups/:groupId/seasons/:seasonId/edit", "routes/season-new.tsx", { id: "routes/season-edit" }),
  route("groups/:groupId/tournaments/new", "routes/tournament-new.tsx"),
  route("groups/:groupId/seasons/:seasonId/picks", "routes/season-picks.tsx"),
  route("groups/:groupId/seasons/:seasonId/reveal", "routes/season-reveal.tsx"),
  route("groups/:groupId/seasons/:seasonId/standings", "routes/season-standings.tsx"),
  route("groups/:groupId/seasons/:seasonId/manual-standings", "routes/season-manual-standings.tsx"),
] satisfies RouteConfig;
