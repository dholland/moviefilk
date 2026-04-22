import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	// Dedupe React so the Workers dev module runner does not load multiple copies
	// (CJS `react-dom` can otherwise surface "module is not defined" in workerd).
	resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
	plugins: [
		devtools(),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		// agents/vite omitted: it pulls @rolldown/plugin-babel and is only needed for
		// @callable() decorators. Re-enable if you add decorated methods on agents.
	],
});

export default config;
