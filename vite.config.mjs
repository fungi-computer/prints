import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: false,
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Share compression across eager code without pulling in lazy views.
          groups: [{ name: "startup", tags: ["$initial"] }],
        },
      },
    },
  },
});
