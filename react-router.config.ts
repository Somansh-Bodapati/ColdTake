import type { Config } from "@react-router/dev/config";

export default {
  // Client-side SPA only — no server, no SSR. Vercel Functions in api/
  // handle the backend; this app is a static build.
  ssr: false,
  appDirectory: "src",
} satisfies Config;
