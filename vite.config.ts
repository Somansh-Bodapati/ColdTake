import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { apiDevServer } from "./vite-plugins/api-dev-server";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), apiDevServer()],
  resolve: {
    tsconfigPaths: true,
  },
});
