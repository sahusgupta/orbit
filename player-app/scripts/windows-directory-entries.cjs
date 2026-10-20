const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const installedFilesystems = new WeakSet();
const typeMethods = [
  'isBlockDevice', 'isCharacterDevice', 'isDirectory', 'isFIFO',
  'isFile', 'isSocket', 'isSymbolicLink'
];

function entryPath(directory, entry) {
  const parent = entry.parentPath ?? entry.path ?? directory;
  const parentPath = parent instanceof URL ? fileURLToPath(parent) : parent;
  if (Buffer.isBuffer(parentPath) || Buffer.isBuffer(entry.name)) {
    return Buffer.concat([
      Buffer.isBuffer(parentPath) ? parentPath : Buffer.from(parentPath),
      Buffer.from(path.sep),
      Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name)
    ]);
  }
  return path.join(parentPath, entry.name);
}

function normalizeEntries(filesystem, directory, entries) {
  return entries.map((entry) => {
    if (!entry.isSymbolicLink()) return entry;
    let stat;
    try {
      stat = filesystem.lstatSync(entryPath(directory, entry));
    } catch (error) {
      // Leave a concurrently removed entry to Metro's existing missing-file
      // handling, without losing the other entries in the directory.
      if (error.code === 'ENOENT') return entry;
      throw error;
    }
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return entry;

    // OneDrive reparse points can appear as symlinks in readdir even though
    // lstat identifies ordinary files/directories. Keep Dirent metadata and
    // its prototype, and use the accurate stat type before Metro reads links.
    const normalized = Object.create(Object.getPrototypeOf(entry), Object.getOwnPropertyDescriptors(entry));
    for (const method of typeMethods) {
      Object.defineProperty(normalized, method, {
        value: () => stat[method](), writable: true, configurable: true, enumerable: false
      });
    }
    return normalized;
  });
}

function installWindowsDirectoryEntryFix(filesystem = fs, platform = process.platform) {
  if (platform !== 'win32' || installedFilesystems.has(filesystem)) return;
  installedFilesystems.add(filesystem);
  const originalReaddir = filesystem.readdir;
  const originalReaddirSync = filesystem.readdirSync;

  filesystem.readdir = function (directory, options, callback) {
    if (!options?.withFileTypes || typeof callback !== 'function') return originalReaddir.apply(this, arguments);
    return originalReaddir.call(this, directory, options, (error, entries) => {
      if (error) return callback(error, entries);
      let normalized;
      try {
        normalized = normalizeEntries(filesystem, directory, entries);
      } catch (statError) {
        return callback(statError);
      }
      callback(null, normalized);
    });
  };

  filesystem.readdirSync = function (directory, options) {
    const entries = originalReaddirSync.apply(this, arguments);
    return options?.withFileTypes ? normalizeEntries(filesystem, directory, entries) : entries;
  };
}

module.exports = { installWindowsDirectoryEntryFix };
