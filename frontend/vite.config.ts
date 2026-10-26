import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://localhost:4000";

  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    plugins: [react(), tailwindcss()],
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
