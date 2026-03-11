import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/lib.ts"),
      name: "dsl2arkui",
      formats: ["es", "umd"],
      fileName: (format) => `dsl2arkui.${format}.js`,
    },
    outDir: "dist/lib",
    rollupOptions: {
      // 无外部依赖，全部打包进去
    },
  },
});
