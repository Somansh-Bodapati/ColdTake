import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("join", "routes/join.tsx"),
  route("groups/:groupId", "routes/group.tsx"),
  route("groups/:groupId/seasons/new", "routes/season-new.tsx"),
  route("groups/:groupId/tournaments/new", "routes/tournament-new.tsx"),
  route("groups/:groupId/seasons/:seasonId/picks", "routes/season-picks.tsx"),
  route("groups/:groupId/seasons/:seasonId/reveal", "routes/season-reveal.tsx"),
  route("groups/:groupId/seasons/:seasonId/standings", "routes/season-standings.tsx"),
  route("groups/:groupId/seasons/:seasonId/manual-standings", "routes/season-manual-standings.tsx"),
] satisfies RouteConfig;
