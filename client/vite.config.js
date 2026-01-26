import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    cssCodeSplit: false, // Bundle all CSS into a single file for easier serving
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name].[ext]"
      }
    }
  }
});
