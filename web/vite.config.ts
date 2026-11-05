import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: "..",
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": { target: process.env.DEV_API_TARGET || "http://localhost:8787", changeOrigin: true },
    },
  },
});
