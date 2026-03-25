# Path Opener

A macOS-native file management tool with a web-based interface for browsing, analyzing, and managing large file hierarchies across drives. Built for backup drive management, duplicate detection, and bulk file operations.

---

## Features

### 1. Folder Tree View
- Hierarchical tree view with expand/collapse navigation
- Virtual scrolling for performance with large file lists
- Filter by substring, exclude patterns, file extensions, and file size range
- File count badges per folder
- Click any path to open it directly in Finder

### 2. Duplicate Detection
- **Duplicate Folders** - Groups folders sharing the same name and size
- **Duplicate Files** - Groups files sharing the same name and size
- Group display with shared metadata for quick comparison

### 3. Large Files Analysis
- Top 50 largest files
- Top 50 largest folders
- Sortable by size

### 4. Extension Report
- Breakdown of all file extensions: count, total size, percentage share
- Click an extension to filter the tree view instantly

### 5. Shopping Cart (Batch Operations)
- Add individual files/folders or all currently filtered files to cart
- Collapsible sidebar (icon-only mode when collapsed)
- Remove individual items or clear all
- Bulk actions: **Delete** (from disk + DB), **Sync** (rsync to destination), **Copy paths**

### 6. Sync (rsync)
- Configurable source (`FROM`) and destination (`TO`) paths
- Syncs selected files from the FROM drive to the TO drive using `rsync -a`
- Generates a timestamped error log file on failure

### 7. Path Verification
- Verify whether a path exists on disk
- Recursive verification: scan an entire subtree and surface missing paths
- One-click removal of missing/dead paths from the database

### 8. Settings
- Configure sync `FROM` and `TO` paths via the Settings tab
- Auto-update toggle: automatically refresh data after operations
- Verify recursively toggle: controls scope of path verification

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express 5 |
| Frontend | Vanilla JS, HTML5, CSS3 (dark theme) |
| Filesystem | Node.js `fs`, `child_process` |
| Sync | System `rsync` |
| Finder integration | macOS `open` command |

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- macOS (required for Finder integration)

### Installation

```bash
cd path-opener
npm install
node server.js
```

Open `http://localhost:3001` in your browser.

### Initial Setup

1. Populate `coreDB.txt` with your file index (see format below), or the app will fall back to `paths.txt`
2. Open Settings and configure your `FROM` and `TO` sync paths
3. Click **Update data** to load the database (or enable Auto-update)

---

## Data Files

| File | Purpose |
|------|---------|
| `coreDB.txt` | Primary file database (read/write) |
| `paths.txt` | Fallback database if coreDB.txt is missing |
| `config.json` | Persisted FROM/TO sync configuration |
| `sync-errors-<timestamp>.txt` | Auto-generated on sync failures |

### coreDB.txt Format

One entry per line:

```
<size_bytes> | <absolute_path>
```

Example:

```
8196 | /Volumes/pcmycloud/Seagate Backup Plus Drive/.DS_Store
167244 | /Volumes/pcmycloud/Seagate Backup Plus Drive/Photos/Originals/img001.jpg
```

### config.json Format

```json
{
  "from": "/Volumes/pcmycloud",
  "to": "/Volumes/Extreme SSD/MYCloud"
}
```

---

## API Reference

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| GET | `/api/config` | Get FROM/TO sync paths | - |
| POST | `/api/config` | Save FROM/TO sync paths | `{ from, to }` |
| GET | `/api/data` | Get raw file database content | - |
| GET | `/api/open?path=<encoded>` | Open path in Finder | URL param |
| POST | `/api/verify` | Check if a single path exists | `{ path }` |
| POST | `/api/verify-path-recursive` | Verify path tree, remove missing entries | `{ path, recursive? }` |
| POST | `/api/remove-paths` | Remove paths from coreDB only | `{ paths[] }` |
| POST | `/api/delete-paths` | Delete from disk and remove from coreDB | `{ paths[] }` |
| POST | `/api/sync` | Rsync selected paths FROM → TO | `{ paths[] }` |

**Security note:** `/api/open` restricts path access to `/Volumes/` and `/Users/` only.

---

## Notes

- Designed and tested on macOS only (uses `open`, `rsync` system commands)
- Delete operations use `fs.rmSync()` with recursive mode for folders
- The `question-display.html` file is an unrelated standalone trivia timer page
