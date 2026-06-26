import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("package exposes only the cbr binary and production files", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.deepEqual(Object.keys(pkg.bin), ["cbr"]);
  assert.equal(pkg.bin.cbr, "./src/contextbrain.js");
  assert.deepEqual(pkg.files, ["src", "README.md", "LICENSE"]);
  assert.equal(pkg.repository.url, "git+https://github.com/botnirbhay/CodexMemory.git");
  assert.equal(pkg.bugs.url, "https://github.com/botnirbhay/CodexMemory/issues");
  assert.ok(pkg.keywords.includes("coding-agent"));
  assert.equal(fs.existsSync("LICENSE"), true);
});


