import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: "../node_modules/.vite/shopsphere",
  build: {
    // Vercel builds from the repository root and looks for the compiled site at
    // <root>/dist. Vite's default would put it in client/dist, one level below
    // where Vercel looks, which is what makes the deploy fail with "No Output
    // Directory named dist found after the Build completed" no matter what the
    // dashboard says the output directory is. Writing to the repository root
    // means the local build and the deployed build are the same thing.
    outDir: "../dist",
    // The directory sits outside Vite's project root, where emptying is not the
    // default, so a file left over from an earlier build would survive.
    emptyOutDir: true,
  },
});
