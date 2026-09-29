const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterFiles,
  formatFileTime,
  validateNewFileName,
  validateFolderName,
  buildFileTree,
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

test("adds the default SQL extension to a new file without one", () => {
  assert.deepEqual(validateNewFileName("  月报  "), {
    valid: true,
    name: "月报.sql",
  });
});

test("rejects paths and unsupported filenames when creating a file", () => {
  assert.equal(validateNewFileName("reports/draft.sql").valid, false);
  assert.equal(validateNewFileName("draft.exe").valid, false);
});

test("accepts one folder name but rejects paths and reserved characters", () => {
  assert.deepEqual(validateFolderName("  报表  "), { valid: true, name: "报表" });
  assert.equal(validateFolderName("上级/报表").valid, false);
  assert.equal(validateFolderName("A:B").valid, false);
});

test("builds one hierarchy with folders before files and preserves empty folders", () => {
  const rows = buildFileTree(
    [{ path: "" }, { path: "docs" }, { path: "empty" }, { path: "docs/nested" }, { path: "finance" }],
    files,
    { expanded: ["", "docs", "docs/nested"] },
  ).rows;
  assert.deepEqual(rows.map(({ kind, path, depth }) => [kind, path, depth]), [
    ["folder", "", 0],
    ["folder", "docs", 1],
    ["folder", "docs/nested", 2],
    ["file", "docs/notes.md", 2],
    ["folder", "empty", 1],
    ["folder", "finance", 1],
    ["file", "archive.txt", 1],
  ]);
});

test("scopes the unified tree to a selected folder and searches within it", () => {
  const folders = [{ path: "" }, { path: "docs" }, { path: "docs/nested" }, { path: "finance" }];
  const entries = [
    ...files,
    { name: "notes.md", path: "docs/nested/notes.md", extension: "md", modified: 400 },
  ];
  const result = buildFileTree(folders, entries, {
    scope: "docs",
    query: "notes",
    expanded: ["docs"],
  });
  assert.equal(result.count, 2);
  assert.deepEqual(result.rows.map(({ path }) => path), [
    "docs",
    "docs/nested",
    "docs/nested/notes.md",
    "docs/notes.md",
  ]);
});

test("collapsed folders keep their files hidden without changing the match count", () => {
  const result = buildFileTree(
    [{ path: "" }, { path: "docs" }, { path: "finance" }],
    files,
    { expanded: [""] },
  );
  assert.equal(result.count, 3);
  assert.deepEqual(result.rows.map(({ path }) => path), [
    "",
    "docs",
    "finance",
    "archive.txt",
  ]);
});

test("hides workspace root without indenting its direct children", () => {
  const result = buildFileTree(
    [{ path: "" }, { path: "docs" }, { path: "docs/nested" }],
    files,
    { expanded: ["", "docs"], hideRoot: true },
  );
  assert.equal(result.count, 3);
  assert.deepEqual(result.rows.map(({ kind, path, depth }) => [kind, path, depth]), [
    ["folder", "docs", 0],
    ["folder", "docs/nested", 1],
    ["file", "docs/notes.md", 1],
    ["file", "archive.txt", 0],
  ]);
});
