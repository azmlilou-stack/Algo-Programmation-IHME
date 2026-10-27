import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configuredBase = process.env.BASE_PATH || "/";
const base = `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
