import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/auth": "http://localhost:3000", "/oauth": "http://localhost:3000", "/mcp": "http://localhost:3000" },
  },
});
