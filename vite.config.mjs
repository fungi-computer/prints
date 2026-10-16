import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: false,
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    assetsInlineLimit: 0,
  },
});
