import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://localhost:4000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // In development the browser calls /api on the Vite origin; Vite forwards it to Express.
      proxy: {
        "/api": { target: apiProxyTarget, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
