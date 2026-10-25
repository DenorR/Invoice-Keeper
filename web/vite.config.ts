import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Сборка кладётся в app/static — её отдаёт FastAPI. В режиме dev запросы /api проксируются на бэкенд.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../app/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: "127.0.0.1", // IPv4: на Windows «localhost» иначе может достаться только IPv6
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
  },
});
