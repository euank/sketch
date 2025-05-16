import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hmrPlugin, presets } from "vite-plugin-web-components-hmr";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    hmrPlugin({
      include: ["./src/**/*.ts"],
      presets: [presets.lit],
    }),
    // Custom plugin for handling the root path redirect and Monaco workers
    {
      name: "configure-server",
      configureServer(server) {
        // Handle root redirects and Monaco worker proxying
        server.middlewares.use((req, res, next) => {
          // Root redirect
          if (req.url === "/") {
            res.writeHead(302, {
              Location: "/src/web-components/demo/index.html",
            });
            res.end();
            return;
          }

          // Monaco worker and asset mapping
          // This ensures the development paths match the production paths

          // Handle worker URLs
          if (req.url?.startsWith("/static/editor.worker.js")) {
            const workerPath =
              "/node_modules/monaco-editor/esm/vs/editor/editor.worker.js";
            res.writeHead(302, { Location: workerPath });
            res.end();
            return;
          }

          if (req.url?.startsWith("/static/json.worker.js")) {
            const workerPath =
              "/node_modules/monaco-editor/esm/vs/language/json/json.worker.js";
            res.writeHead(302, { Location: workerPath });
            res.end();
            return;
          }

          if (req.url?.startsWith("/static/css.worker.js")) {
            const workerPath =
              "/node_modules/monaco-editor/esm/vs/language/css/css.worker.js";
            res.writeHead(302, { Location: workerPath });
            res.end();
            return;
          }

          if (req.url?.startsWith("/static/html.worker.js")) {
            const workerPath =
              "/node_modules/monaco-editor/esm/vs/language/html/html.worker.js";
            res.writeHead(302, { Location: workerPath });
            res.end();
            return;
          }

          if (req.url?.startsWith("/static/ts.worker.js")) {
            const workerPath =
              "/node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js";
            res.writeHead(302, { Location: workerPath });
            res.end();
            return;
          }

          // Handle CSS and font files
          if (
            req.url?.startsWith("/static/monaco/min/vs/editor/editor.main.css")
          ) {
            const cssPath =
              "/node_modules/monaco-editor/min/vs/editor/editor.main.css";
            res.writeHead(302, { Location: cssPath });
            res.end();
            return;
          }

          if (
            req.url?.startsWith(
              "/static/monaco/min/vs/base/browser/ui/codicons/codicon/codicon.ttf",
            )
          ) {
            const fontPath =
              "/node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf";
            res.writeHead(302, { Location: fontPath });
            res.end();
            return;
          }

          next();
        });
      },
    },
  ],
  server: {
    // Define a middleware to handle the root path redirects
    middlewareMode: false,
    fs: {
      // Allow serving files from these directories
      allow: ["."],
    },
  },
  // Configure Monaco Editor
  resolve: {
    alias: {
      "monaco-editor": "monaco-editor/esm/vs/editor/editor.api",
    },
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  // Allow importing CSS as string
  css: {
    preprocessorOptions: {
      additionalData: '@import "monaco-editor/min/vs/editor/editor.main.css";',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "monaco-editor": ["monaco-editor"],
          // Add separate chunks for Monaco editor workers
          "monaco-editor-worker": ["monaco-editor/esm/vs/editor/editor.worker"],
          "monaco-json-worker": [
            "monaco-editor/esm/vs/language/json/json.worker",
          ],
          "monaco-css-worker": ["monaco-editor/esm/vs/language/css/css.worker"],
          "monaco-html-worker": [
            "monaco-editor/esm/vs/language/html/html.worker",
          ],
          "monaco-ts-worker": [
            "monaco-editor/esm/vs/language/typescript/ts.worker",
          ],
        },
      },
    },
  },
});
