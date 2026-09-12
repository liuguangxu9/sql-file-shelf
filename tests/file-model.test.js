const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterFiles,
  formatFileTime,
  validateNewFileName,
} = require("../src/file-model");

const files = [
  { name: "notes.md", path: "docs/notes.md", extension: "md", modified: 100 },
  {
    name: "report.sql",
    path: "finance/report.sql",
    extension: "sql",
    modified: 300,
  },
  { name: "archive.txt", path: "archive.txt", extension: "txt", modified: 200 },
];

test("lists newest files first when no filter is given", () => {
  assert.deepEqual(
    filterFiles(files, "").map((file) => file.name),
    ["report.sql", "archive.txt", "notes.md"],
  );
});

test("matches file name, relative path, and extension without case sensitivity", () => {
  assert.deepEqual(
    filterFiles(files, "FINANCE").map((file) => file.name),
    ["report.sql"],
  );
  assert.deepEqual(
    filterFiles(files, ".MD").map((file) => file.name),
    ["notes.md"],
  );
});

test("formats an absent timestamp safely", () => {
  assert.equal(formatFileTime(0), "—");
});

test("sorts files by an explicitly selected column and direction", () => {
  assert.deepEqual(
    filterFiles(files, "", { key: "name", direction: "asc" }).map(
      (file) => file.name,
    ),
    ["archive.txt", "notes.md", "report.sql"],
  );
  assert.deepEqual(
    filterFiles(files, "", { key: "extension", direction: "desc" }).map(
      (file) => file.name,
    ),
    ["archive.txt", "report.sql", "notes.md"],
  );
});

test("accepts a root-level supported filename when creating a file", () => {
  assert.deepEqual(validateNewFileName("  draft.sql  "), {
    valid: true,
    name: "draft.sql",
  });
});

test("rejects paths and unsupported filenames when creating a file", () => {
  assert.equal(validateNewFileName("reports/draft.sql").valid, false);
  assert.equal(validateNewFileName("draft.exe").valid, false);
});
