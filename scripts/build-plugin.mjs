import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "plugin");
const destination = join(root, "dist", "plugin");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
const schema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

if (manifest.$schema !== schema || manifest.name !== "aviators-newsletter") {
  throw new Error("The Aviators plugin manifest has an invalid schema or name.");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("The companion version must be a semantic version.");
}
if (process.argv.slice(2).some((argument) => argument !== "--prepare")) {
  throw new Error("Usage: node scripts/build-plugin.mjs [--prepare]");
}

const files = [
  "plugin.json",
  "README.md",
  join("references", "workflow.md"),
  ...["newsletter", "ace", "product", "community", "preview", "persist"].map(
    (skill) => join("skills", skill, "SKILL.md")
  ),
  join("com.github.copilot", "agents", "aviators.agent.md")
];
for (const file of files) {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  if (file === "plugin.json") {
    await writeFile(
      target,
      `${JSON.stringify({ ...manifest, version: packageJson.version }, null, 2)}\n`
    );
  } else {
    await copyFile(join(source, file), target);
  }
}

for (const prompt of ["aceAviator", "productGroup", "communityNews", "dateWindow"]) {
  const file = join("references", `${prompt}.md`);
  await mkdir(dirname(join(destination, file)), { recursive: true });
  await copyFile(join(root, "src", "prompts", `${prompt}.md`), join(destination, file));
  files.push(file);
}
await copyFile(join(root, "LICENSE"), join(destination, "LICENSE"));
files.push("LICENSE");

console.log(`[plugin] Prepared ${files.length} files in ${destination}.`);
if (!process.argv.includes("--prepare")) {
  const release = join(root, "release");
  await mkdir(release, { recursive: true });
  const archive = join(release, `aviators-newsletter-plugin-${packageJson.version}.tar.gz`);
  const result = spawnSync(
    "tar",
    ["-czf", archive, "-C", destination, ...files],
    { stdio: "inherit", shell: false }
  );
  if (result.error) {
    throw new Error(`Cannot create the plugin archive: ${result.error.message}. Install tar on the build host.`);
  }
  if (result.status !== 0) {
    throw new Error(`Plugin archive creation failed with exit code ${result.status}.`);
  }
  console.log(`[plugin] Created ${archive}.`);
}
