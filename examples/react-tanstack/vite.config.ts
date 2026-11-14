import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { warpstate } from "@warpstate/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [warpstate(), tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
});
