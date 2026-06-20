import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEnv, loadEnv } from "../src/server/load-env.js";

test("parseEnv handles comments, quotes, export and blank lines", () => {
  const parsed = parseEnv(
    [
      "# a comment",
      "",
      "PORT=8080",
      "export LEAGUE='Runes of Aldur'",
      'NAME="quoted value"',
      "ESCAPED=\"line1\\nline2\"",
      "PORT2=8080 # inline comment",
      'HASHVAL="a#b"',
      "RAWHASH=a#b",
      "=bad",
      "BAD KEY=1",
      "EMPTY=",
    ].join("\n"),
  );
  assert.equal(parsed.PORT, "8080");
  assert.equal(parsed.LEAGUE, "Runes of Aldur");
  assert.equal(parsed.NAME, "quoted value");
  assert.equal(parsed.ESCAPED, "line1\nline2");
  assert.equal(parsed.PORT2, "8080"); // inline comment stripped from unquoted value
  assert.equal(parsed.HASHVAL, "a#b"); // quoted value keeps its #
  assert.equal(parsed.RAWHASH, "a#b"); // # without preceding space is part of the value
  assert.equal(parsed.EMPTY, "");
  assert.ok(!("BAD KEY" in parsed));
});

test("loadEnv never overrides existing env and is a no-op when the file is missing", () => {
  const target = { PORT: "9999" };
  const applied = loadEnv({ path: "/definitely/not/here/.env", target });
  assert.deepEqual(applied, []);
  assert.equal(target.PORT, "9999"); // untouched
});
