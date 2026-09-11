import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  base: "",
  plugins: [svelte()],
  build: {
    // keep the AudioWorklet module as a real file — data: URIs are not
    // reliably accepted by audioWorklet.addModule() in all browsers
    assetsInlineLimit: 0,
  },
});
