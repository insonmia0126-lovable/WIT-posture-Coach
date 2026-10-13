import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 43124,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 43124,
    strictPort: true,
  },
});
