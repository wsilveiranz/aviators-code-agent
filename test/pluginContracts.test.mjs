import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "plugin");
const sourceOnly = process.argv.includes("--source-only");
const artifact = path.join(root, "dist", "plugin");
const schema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const prefix = "aviators.aviators-newsletter/";
const skills = ["ace", "community", "newsletter", "persist", "preview", "product"];
const canonical = ["aceAviator.md", "communityNews.md", "dateWindow.md", "productGroup.md"];
const expectedTools = [
  "computeDateWindow", "beginNewsletterWorkflow", "createNewsletterTemplate",
  "getNewsletterWorkflow", "reviewNewsletterWorkflow", "persistNewsletterDraft", "openNewsletterPreview",
  "createAceAviator", "createProductGroupNews", "createCommunityNews",
  "getEmailFromMCP", "scrapeLinkedIn", "resolveRedirects", "playwright_navigate",
  "getTechCommunityBlogPosts"
].map(name => `${prefix}${name}`);

function read(file) {
  return readFileSync(file, "utf8");
}

function frontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(read(file));
  assert.ok(match, `${file}: missing YAML frontmatter`);
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z-]*):\s*(.+)$/.exec(line);
    assert.ok(field, `${file}: expected a supported single-line frontmatter field`);
    assert.ok(!fields.has(field[1]), `${file}: duplicate ${field[1]}`);
    fields.set(field[1], field[2]);
  }
  return fields;
}

function files(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    assert.ok(!entry.isSymbolicLink(), `${file}: package must not depend on symlinks`);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function validateLayout(folder) {
  const manifest = JSON.parse(read(path.join(folder, "plugin.json")));
  assert.equal(manifest.$schema, schema);
  assert.equal(manifest.name, "aviators-newsletter");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  for (const field of ["skills", "agents", "mcpServers", "hooks", "commands"]) {
    assert.ok(!(field in manifest), `Nonstandard top-level plugin field: ${field}`);
  }
  assert.ok(!existsSync(path.join(folder, "mcp.json")), "Do not duplicate companion MCP definitions");
  assert.deepEqual(readdirSync(path.join(folder, "skills")).sort(), skills);
  for (const name of skills) {
    const file = path.join(folder, "skills", name, "SKILL.md");
    const fields = frontmatter(file);
    assert.equal(fields.get("name"), name, `${name}: directory/frontmatter mismatch`);
    assert.equal(fields.get("disable-model-invocation"), "true", `${name}: must be explicitly invoked`);
    assert.ok(fields.get("description"), `${name}: missing description`);
    assert.ok(fields.get("argument-hint"), `${name}: missing argument guidance`);
    assert.ok(read(file).includes(`/aviators-newsletter:${name}`), `${name}: missing namespaced invocation`);
  }
  const agent = path.join(folder, "com.github.copilot", "agents", "aviators.agent.md");
  const fields = frontmatter(agent);
  assert.equal(fields.get("name"), "Aviators");
  assert.equal(fields.get("target"), "github-copilot");
  assert.ok(fields.get("description"));
  for (const field of ["model", "skills", "handoffs", "agents", "mcp-servers"]) {
    assert.ok(!fields.has(field), `Agent must not configure ${field}`);
  }
  const tools = JSON.parse(fields.get("tools"));
  assert.deepEqual([...new Set(tools)].sort(), tools.slice().sort(), "Agent tools must be unique");
  assert.deepEqual(tools.filter(tool => tool.startsWith(prefix)).sort(), expectedTools.slice().sort());
  assert.deepEqual(tools.filter(tool => !tool.startsWith(prefix)).sort(), ["read", "search"]);
  return manifest;
}

function validateLinks(folder, allowCanonicalSource) {
  for (const file of files(folder).filter(file => file.endsWith(".md"))) {
    for (const match of read(file).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), target.split("#")[0]);
      const relative = path.relative(folder, resolved);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative),
        `${file}: link escapes plugin: ${target}`);
      const canonicalTarget = canonical.some(name => resolved === path.join(folder, "references", name));
      if (allowCanonicalSource && canonicalTarget) {
        assert.ok(existsSync(path.join(root, "src", "prompts", path.basename(resolved))),
          `Missing canonical source for ${target}`);
      } else {
        assert.ok(existsSync(resolved), `${file}: missing packaged link ${target}`);
      }
    }
  }
}

function validatePackagedManifest(authored, generated, companionVersion) {
  assert.equal(generated.version, companionVersion, "Generated plugin and effective VSIX versions must match");
  assert.deepEqual(generated, { ...authored, version: companionVersion },
    "Built manifest differs from source outside the effective version");
}

function validateVersionOverride(packageManifest, authored) {
  const fixture = path.join(root, `.plugin-contract-fixture-${randomUUID()}`);
  const effectiveVersion = "9.8.7-contract-fixture";
  try {
    mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    mkdirSync(path.join(fixture, "src", "prompts"), { recursive: true });
    cpSync(source, path.join(fixture, "plugin"), { recursive: true });
    cpSync(path.join(root, "scripts", "build-plugin.mjs"), path.join(fixture, "scripts", "build-plugin.mjs"));
    cpSync(path.join(root, "LICENSE"), path.join(fixture, "LICENSE"));
    for (const name of canonical) {
      cpSync(path.join(root, "src", "prompts", name), path.join(fixture, "src", "prompts", name));
    }
    writeFileSync(path.join(fixture, "package.json"),
      JSON.stringify({ ...packageManifest, version: effectiveVersion }));
    const result = spawnSync(process.execPath,
      [path.join(fixture, "scripts", "build-plugin.mjs"), "--prepare"],
      { cwd: fixture, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `Version fixture build failed: ${result.stdout}\n${result.stderr}`);
    const generated = validateLayout(path.join(fixture, "dist", "plugin"));
    validatePackagedManifest(authored, generated, effectiveVersion);
    assert.equal(JSON.parse(read(path.join(fixture, "plugin", "plugin.json"))).version, authored.version,
      "Build must not modify the authored template version");
    assert.throws(() => validatePackagedManifest(authored, { ...generated, version: authored.version },
      effectiveVersion), /Generated plugin and effective VSIX versions must match/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const sourceManifest = validateLayout(source);
validateLinks(source, true);
for (const name of canonical) {
  assert.ok(!existsSync(path.join(source, "references", name)),
    "Canonical workflows must be materialized, not maintained as source duplicates");
}
for (const [skill, reference] of [
  ["ace", "aceAviator.md"], ["product", "productGroup.md"], ["community", "communityNews.md"]
]) {
  const text = read(path.join(source, "skills", skill, "SKILL.md"));
  assert.ok(text.includes(`../../references/${reference}`), `${skill}: missing canonical procedure link`);
  assert.ok(text.includes("../../references/dateWindow.md"), `${skill}: missing shared date procedure`);
}

if (!sourceOnly) {
  const packageManifest = JSON.parse(read(path.join(root, "package.json")));
  const contributed = new Set(packageManifest.contributes.languageModelTools
    .filter(tool => tool.canBeReferencedInPrompt)
    .map(tool => `${packageManifest.publisher}.${packageManifest.name}/${tool.toolReferenceName}`));
  for (const tool of expectedTools) {
    assert.ok(contributed.has(tool), `Agent tool not referenceable in actual package manifest: ${tool}`);
  }
  for (const file of files(source).filter(file => file.endsWith(".md"))) {
    for (const match of read(file).matchAll(/aviators\.aviators-newsletter\/([A-Za-z][A-Za-z0-9_]*)/g)) {
      assert.ok(contributed.has(`${prefix}${match[1]}`), `${file}: unknown companion tool ${match[1]}`);
    }
  }
  assert.ok(existsSync(artifact), "Materialize dist\\plugin before running artifact contracts");
  validatePackagedManifest(sourceManifest, validateLayout(artifact), packageManifest.version);
  validateLinks(artifact, false);
  const expectedFiles = new Set(files(source).map(file => path.relative(source, file)));
  for (const name of canonical) expectedFiles.add(path.join("references", name));
  expectedFiles.add("LICENSE");
  assert.deepEqual(files(artifact).map(file => path.relative(artifact, file)).sort(),
    [...expectedFiles].sort(), "Artifact contains missing or unexpected files");
  for (const file of files(source)) {
    if (path.basename(file) === "plugin.json") continue;
    const built = path.join(artifact, path.relative(source, file));
    assert.equal(read(built), read(file), `${built}: stale packaged source`);
  }
  for (const name of canonical) {
    assert.equal(read(path.join(artifact, "references", name)),
      read(path.join(root, "src", "prompts", name)), `${name}: canonical instruction drift`);
  }
  assert.equal(read(path.join(artifact, "LICENSE")), read(path.join(root, "LICENSE")));
  validateVersionOverride(packageManifest, sourceManifest);
}

console.log(`Plugin ${sourceOnly ? "source" : "source, manifest, artifact, and isolated version-override"} contracts passed.`);
