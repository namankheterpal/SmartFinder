const express = require("express");
const path = require("path");
const { execFile, spawn } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = 3001;
const ROOT = __dirname;
const CORE_DB = path.join(ROOT, "coreDB.txt");
const CONFIG_FILE = path.join(ROOT, "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const parsed = JSON.parse(data);
      return {
        from: String(parsed.from || "").trim(),
        to: String(parsed.to || "").trim(),
      };
    }
  } catch (_) {}
  return { from: "", to: "" };
}

app.use(express.json());
app.use(express.static(ROOT));

// GET /api/config - load application config (FROM/TO paths)
app.get("/api/config", (req, res) => {
  res.json(loadConfig());
});

// POST /api/config - save application config
app.post("/api/config", (req, res) => {
  const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ from, to }, null, 2),
      "utf8",
    );
    res.json({ from, to });
  } catch (err) {
    res.status(500).json({ error: "Failed to write config" });
  }
});

// GET /api/data - raw coreDB content
app.get("/api/data", (req, res) => {
  const file = fs.existsSync(CORE_DB) ? CORE_DB : path.join(ROOT, "paths.txt");
  fs.readFile(file, "utf8", (err, data) => {
    if (err) return res.status(500).send("Failed to read coreDB");
    res.type("text/plain").send(data);
  });
});

// POST /api/verify-path-recursive - verify paths under root, remove missing from coreDB
app.post("/api/verify-path-recursive", (req, res) => {
  const p = req.body?.path;
  const recursive = req.body?.recursive !== false;
  if (typeof p !== "string" || !p.trim())
    return res.status(400).json({ error: "Missing path" });
  const rootPath = decodeURIComponent(p).trim().replace(/\/$/, "");
  const file = fs.existsSync(CORE_DB) ? CORE_DB : path.join(ROOT, "paths.txt");
  fs.readFile(file, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to read coreDB" });
    const lines = data.split("\n").filter(Boolean);
    const toCheck = new Set();
    const coreDBPaths = [];
    for (const line of lines) {
      const idx = line.indexOf(" | ");
      const filePath = idx >= 0 ? line.slice(idx + 3).trim() : "";
      if (!filePath) continue;
      const isUnderRoot =
        filePath === rootPath || filePath.startsWith(rootPath + "/");
      if (!isUnderRoot) continue;
      if (recursive) {
        toCheck.add(filePath);
      } else {
        const suffix = filePath.slice(rootPath.length + 1);
        if (suffix.indexOf("/") === -1) {
          toCheck.add(filePath);
        } else {
          const firstSegment = suffix.split("/")[0];
          const childPath = rootPath + "/" + firstSegment;
          toCheck.add(childPath);
        }
      }
      coreDBPaths.push(filePath);
    }
    const missing = [];
    for (const fp of toCheck) {
      try {
        if (!fs.existsSync(fp)) missing.push(fp);
      } catch (_) {
        missing.push(fp);
      }
    }
    const toRemove = new Set();
    for (const fp of missing) {
      if (coreDBPaths.includes(fp)) {
        toRemove.add(fp);
      } else if (fp.startsWith(rootPath + "/") || fp === rootPath) {
        for (const dbPath of coreDBPaths) {
          if (dbPath === fp || dbPath.startsWith(fp + "/")) {
            toRemove.add(dbPath);
          }
        }
      }
    }
    const toKeep = lines.filter((line) => {
      const idx = line.indexOf(" | ");
      const filePath = idx >= 0 ? line.slice(idx + 3).trim() : "";
      return !toRemove.has(filePath);
    });
    fs.writeFile(
      file,
      toKeep.join("\n") + (toKeep.length ? "\n" : ""),
      (writeErr) => {
        if (writeErr)
          return res.status(500).json({ error: "Failed to write coreDB" });
        res.json({
          ok: true,
          verified: toCheck.size,
          removed: toRemove.size,
          removedPaths: Array.from(toRemove),
        });
      },
    );
  });
});

// POST /api/verify - check if path exists on disk
app.post("/api/verify", (req, res) => {
  const p = req.body?.path;
  if (typeof p !== "string" || !p.trim())
    return res.status(400).json({ error: "Missing path" });
  const decoded = decodeURIComponent(p).trim();
  fs.stat(decoded, (err) => {
    res.json({ exists: !err });
  });
});

// POST /api/remove-paths - remove paths from coreDB (and all files under if path is folder)
app.post("/api/remove-paths", (req, res) => {
  const paths = req.body?.paths;
  if (!Array.isArray(paths) || paths.length === 0)
    return res.status(400).json({ error: "Missing paths array" });
  const toRemove = paths
    .map((p) => (typeof p === "string" ? decodeURIComponent(p).trim() : ""))
    .filter(Boolean);
  const file = fs.existsSync(CORE_DB) ? CORE_DB : path.join(ROOT, "paths.txt");
  fs.readFile(file, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to read coreDB" });
    const lines = data.split("\n").filter((line) => {
      const idx = line.indexOf(" | ");
      const filePath = idx >= 0 ? line.slice(idx + 3).trim() : "";
      const remove = toRemove.some(
        (r) => filePath === r || filePath.startsWith(r + "/"),
      );
      return !remove;
    });
    fs.writeFile(
      file,
      lines.join("\n") + (lines.length ? "\n" : ""),
      (writeErr) => {
        if (writeErr)
          return res.status(500).json({ error: "Failed to write coreDB" });
        res.json({ ok: true, remaining: lines.length });
      },
    );
  });
});

// POST /api/delete-paths - delete paths from filesystem and coreDB
app.post("/api/delete-paths", (req, res) => {
  const paths = req.body?.paths;
  if (!Array.isArray(paths) || paths.length === 0)
    return res.status(400).json({ error: "Missing paths array" });
  const toDelete = paths
    .map((p) => (typeof p === "string" ? decodeURIComponent(p).trim() : ""))
    .filter(Boolean);
  console.log("[delete] Starting: " + toDelete.length + " path(s)");
  const errors = [];
  const successfullyDeleted = [];
  let i = 0;
  for (const p of toDelete) {
    i++;
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true });
        successfullyDeleted.push(p);
        console.log("[delete] " + i + "/" + toDelete.length + " deleted: " + p);
      } else {
        successfullyDeleted.push(p);
        console.log(
          "[delete] " + i + "/" + toDelete.length + " skip (not found): " + p,
        );
      }
    } catch (err) {
      errors.push({ path: p, message: err.message });
      console.log(
        "[delete] " +
          i +
          "/" +
          toDelete.length +
          " FAILED: " +
          p +
          " - " +
          err.message,
      );
    }
  }
  console.log(
    "[delete] Filesystem done. Deleted: " +
      successfullyDeleted.length +
      ", failed: " +
      errors.length,
  );
  const file = fs.existsSync(CORE_DB) ? CORE_DB : path.join(ROOT, "paths.txt");
  fs.readFile(file, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to read coreDB" });
    const lines = data.split("\n").filter((line) => {
      const idx = line.indexOf(" | ");
      const filePath = idx >= 0 ? line.slice(idx + 3).trim() : "";
      const remove = successfullyDeleted.some(
        (r) => filePath === r || filePath.startsWith(r + "/"),
      );
      return !remove;
    });
    fs.writeFile(
      file,
      lines.join("\n") + (lines.length ? "\n" : ""),
      (writeErr) => {
        if (writeErr)
          return res.status(500).json({ error: "Failed to write coreDB" });
        console.log(
          "[delete] coreDB updated. Remaining lines: " + lines.length,
        );
        res.json({
          ok: true,
          remaining: lines.length,
          errors: errors.length ? errors : undefined,
        });
      },
    );
  });
});

// POST /api/sync - rsync cart paths: remove FROM prefix, prepend TO
app.post("/api/sync", (req, res) => {
  const paths = req.body?.paths;
  if (!Array.isArray(paths) || paths.length === 0)
    return res.status(400).json({ error: "Missing paths array" });
  const config = loadConfig();
  const fromPrefix = (config.from || "").replace(/\/?$/, "");
  const toPrefix = (config.to || "").replace(/\/?$/, "");
  if (!fromPrefix || !toPrefix)
    return res
      .status(400)
      .json({ error: "Configure FROM and TO in Settings first" });
  const decoded = paths
    .map((p) => (typeof p === "string" ? decodeURIComponent(p).trim() : ""))
    .filter(Boolean);
  const pairs = [];
  for (const p of decoded) {
    if (!p.startsWith(fromPrefix + "/") && p !== fromPrefix) continue;
    const rel = p === fromPrefix ? "" : p.slice(fromPrefix.length + 1);
    const dest = rel ? path.join(toPrefix, rel) : toPrefix;
    pairs.push({ src: p, dest });
  }
  console.log(
    "[sync] Starting: " +
      pairs.length +
      " path(s), FROM: " +
      fromPrefix +
      ", TO: " +
      toPrefix,
  );
  const errorLogPath = path.join(
    ROOT,
    "sync-errors-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt",
  );
  const failed = [];
  let done = 0;
  function runNext() {
    if (done >= pairs.length) {
      console.log(
        "[sync] Done. Synced: " +
          (pairs.length - failed.length) +
          ", failed: " +
          failed.length,
      );
      if (failed.length) {
        try {
          fs.writeFileSync(
            errorLogPath,
            failed.map((f) => f.path + "\t" + f.message).join("\n") + "\n",
            "utf8",
          );
          console.log("[sync] Error log: " + errorLogPath);
        } catch (_) {}
      }
      return res.json({
        ok: true,
        failed: failed.length ? failed.map((f) => f.path) : undefined,
      });
    }
    const { src, dest } = pairs[done];
    const n = done + 1;
    console.log(
      "[sync] " + n + "/" + pairs.length + " syncing: " + src + " -> " + dest,
    );
    const isDir = fs.existsSync(src) && fs.statSync(src).isDirectory();
    const rsyncDest = isDir ? dest + "/" : path.dirname(dest) + "/";
    const rsyncSrc = isDir ? src + "/" : src;
    const args = ["-a", rsyncSrc, rsyncDest];
    const child = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code !== 0) {
        failed.push({ path: src, message: stderr || "exit " + code });
        console.log(
          "[sync] " +
            n +
            "/" +
            pairs.length +
            " FAILED: " +
            src +
            " - " +
            (stderr || "exit " + code),
        );
      } else {
        console.log("[sync] " + n + "/" + pairs.length + " OK: " + src);
      }
      done++;
      runNext();
    });
  }
  runNext();
});

// GET /api/pick-folder - open native macOS folder picker and return selected path
app.get("/api/pick-folder", (req, res) => {
  const prompt = req.query.prompt || "Select a folder";
  execFile(
    "osascript",
    ["-e", `POSIX path of (choose folder with prompt "${prompt}")`],
    (err, stdout) => {
      if (err) {
        // User cancelled or osascript failed
        return res.json({ cancelled: true });
      }
      res.json({ path: stdout.trim().replace(/\/$/, "") });
    },
  );
});

// POST /api/build-db - recursively scan FROM path and (re)build coreDB.txt
app.post("/api/build-db", async (req, res) => {
  const config = loadConfig();
  const fromPath = (config.from || "").trim().replace(/\/$/, "");
  if (!fromPath)
    return res.status(400).json({ error: "FROM path is not configured. Set it in Settings first." });

  try {
    await fs.promises.access(fromPath);
  } catch (_) {
    return res.status(400).json({ error: "FROM path does not exist on disk: " + fromPath });
  }

  let count = 0;
  const writeStream = fs.createWriteStream(CORE_DB, { encoding: "utf8" });

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(full);
          writeStream.write(stat.size + " | " + full + "\n");
          count++;
        } catch (_) {}
      }
    }
  }

  try {
    await walk(fromPath);
    await new Promise((resolve, reject) =>
      writeStream.end((err) => (err ? reject(err) : resolve())),
    );
    console.log("[build-db] Done. " + count + " files written to coreDB.txt");
    res.json({ ok: true, count });
  } catch (err) {
    writeStream.end();
    res.status(500).json({ error: err.message });
  }
});

// API: open path in Finder
app.get("/api/open", (req, res) => {
  const rawPath = req.query.path;
  if (!rawPath || typeof rawPath !== "string") {
    return res.status(400).send("Missing path parameter");
  }

  const decodedPath = decodeURIComponent(rawPath).trim();

  // Optional: restrict to /Volumes/ or /Users/ for safety
  if (
    !decodedPath.startsWith("/Volumes/") &&
    !decodedPath.startsWith("/Users/")
  ) {
    return res.status(403).send("Path must start with /Volumes/ or /Users/");
  }

  fs.stat(decodedPath, (err, stats) => {
    if (err) {
      return res.status(404).send("Path not found");
    }

    const args = stats.isFile() ? ["-R", decodedPath] : [decodedPath];

    execFile("open", args, (execErr) => {
      if (execErr) {
        return res.status(500).send("Failed to open in Finder");
      }
      res.send("OK");
    });
  });
});

app.listen(PORT, () => {
  console.log(`Path Opener running at http://localhost:${PORT}`);
});
