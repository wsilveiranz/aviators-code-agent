import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info"
});

if (watch) {
  await context.watch();
  console.log("[build] Watching extension sources.");
} else {
  await context.rebuild();
  await context.dispose();
}
