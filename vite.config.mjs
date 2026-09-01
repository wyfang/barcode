import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const barcodeRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/barcode/",
  root: barcodeRoot,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      filename: "sw.js",
      includeAssets: [
        "icons/app-icon.svg",
        "icons/apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-192.png",
        "icons/maskable-512.png",
      ],
      injectRegister: false,
      manifest: {
        id: "/barcode/",
        name: "欧阳骏条码工作台",
        short_name: "条码工作台",
        description: "快速粘贴编号并生成条码，支持批量下载和离线使用。",
        lang: "zh-CN",
        start_url: "/barcode/",
        scope: "/barcode/",
        display: "standalone",
        background_color: "#f4f4f5",
        theme_color: "#111111",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "/barcode/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/barcode/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/barcode/icons/maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/barcode/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      registerType: "prompt",
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        globPatterns: ["**/*.{html,js,css,svg,png,woff2}"],
        navigateFallback: "/barcode/index.html",
        skipWaiting: false,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 600,
    emptyOutDir: true,
    outDir: path.resolve(barcodeRoot, "dist"),
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
  },
});
