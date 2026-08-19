import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("groups/:groupId", "routes/group.tsx"),
  route("groups/:groupId/seasons/new", "routes/season-new.tsx"),
] satisfies RouteConfig;
