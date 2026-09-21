import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registry from "./resource-automation.json" with { type: "json" };

const mimeTypes = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
};

export default defineConfig({
  integrations: [react(), {
    name: "exclude-unpublished-quarter-assets",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        if (process.env.INCLUDE_DRAFT_QUARTERS === "1") return;
        const output = fileURLToPath(dir);
        for (const quarter of registry.quarters) {
          if (quarter.status !== "draft") continue;
          if (!/^\d{4}-q[1-4]$/.test(quarter.id)) throw new Error("Invalid draft quarter id");
          await fs.rm(path.join(output, "recursos", quarter.id), { recursive: true, force: true });
          await fs.rm(path.join(output, "images", quarter.id), { recursive: true, force: true });
          await fs.rm(path.join(output, "manifests", `${quarter.id}.json`), { force: true });
        }
      },
    },
  }],
  vite: {
    optimizeDeps: {
      include: ["html2pdf.js"],
    },
    plugins: [
      {
        name: "set-mime-types",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || "";
            const ext = url.substring(url.lastIndexOf("."));
            if (mimeTypes[ext]) {
              res.setHeader("Content-Type", mimeTypes[ext]);
            }
            next();
          });
        },
      },
    ],
  },
});
