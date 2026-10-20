import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { installWindowsDirectoryEntryFix } = require('../player-app/scripts/windows-directory-entries.cjs');

function fileType(type) {
  return Object.fromEntries([
    'isBlockDevice', 'isCharacterDevice', 'isDirectory', 'isFIFO',
    'isFile', 'isSocket', 'isSymbolicLink'
  ].map((method) => [method, () => method === type]));
}

function fixture(entries, stat = fileType('isFile')) {
  const filesystem = {
    readdir: vi.fn((_directory, options, callback) => {
      (typeof options === 'function' ? options : callback)(null, entries);
      return 'original-return';
    }),
    readdirSync: vi.fn(() => entries),
    lstatSync: vi.fn(() => stat)
  };
  return filesystem;
}

describe('Windows Metro directory entries', () => {
  it.each(['isFile', 'isDirectory'])('corrects a cloud reparse entry to %s in callback and sync reads', (type) => {
    const entry = { name: 'module.js', parentPath: path.resolve('nested'), ...fileType('isSymbolicLink') };
    const filesystem = fixture([entry], fileType(type));
    installWindowsDirectoryEntryFix(filesystem, 'win32');

    const callback = vi.fn();
    expect(filesystem.readdir('root', { withFileTypes: true }, callback)).toBe('original-return');
    const synchronous = filesystem.readdirSync('root', { withFileTypes: true });
    for (const normalized of [callback.mock.calls[0][1][0], synchronous[0]]) {
      expect(normalized.name).toBe(entry.name);
      expect(normalized.parentPath).toBe(entry.parentPath);
      expect(Object.getPrototypeOf(normalized)).toBe(Object.getPrototypeOf(entry));
      expect({ ...normalized }).toMatchObject({ name: entry.name, parentPath: entry.parentPath });
      expect(normalized[type]()).toBe(true);
      expect(normalized.isSymbolicLink()).toBe(false);
    }
    expect(filesystem.lstatSync).toHaveBeenCalledWith(path.join(entry.parentPath, entry.name));
  });

  it('preserves real symlinks and does not stat ordinary file/directory entries', () => {
    const entries = ['isFile', 'isDirectory', 'isSymbolicLink'].map((type) => ({ name: type, ...fileType(type) }));
    const filesystem = fixture(entries, fileType('isSymbolicLink'));
    installWindowsDirectoryEntryFix(filesystem, 'win32');

    const result = filesystem.readdirSync('root', { withFileTypes: true });
    result.forEach((entry, index) => expect(entry).toBe(entries[index]));
    expect(filesystem.lstatSync).toHaveBeenCalledExactlyOnceWith(path.join('root', 'isSymbolicLink'));
  });

  it('preserves filename-only reads, their overloads and return values', () => {
    const filesystem = fixture(['module.js']);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const callback = vi.fn();

    expect(filesystem.readdir('root', callback)).toBe('original-return');
    expect(filesystem.readdir('root', 'utf8', callback)).toBe('original-return');
    expect(callback).toHaveBeenCalledWith(null, ['module.js']);
    expect(filesystem.readdirSync('root')).toEqual(['module.js']);
    expect(filesystem.lstatSync).not.toHaveBeenCalled();
  });

  it('uses each recursive entry parent rather than the requested root', () => {
    const entry = { name: 'module.js', path: path.resolve('root', 'nested'), ...fileType('isSymbolicLink') };
    const filesystem = fixture([entry]);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    filesystem.readdirSync('root', { withFileTypes: true, recursive: true });
    expect(filesystem.lstatSync).toHaveBeenCalledWith(path.join(entry.path, entry.name));
  });

  it('accepts URL directories and retains raw Buffer path/name bytes', () => {
    const entry = { name: 'module.js', ...fileType('isSymbolicLink') };
    const filesystem = fixture([entry]);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const directory = path.resolve('root');
    filesystem.readdirSync(pathToFileURL(directory), { withFileTypes: true });
    expect(filesystem.lstatSync).toHaveBeenLastCalledWith(path.join(directory, entry.name));

    entry.name = Buffer.from([0xff, 0x2e, 0x6a, 0x73]);
    filesystem.readdirSync(Buffer.from(directory), { withFileTypes: true, encoding: 'buffer' });
    expect(filesystem.lstatSync).toHaveBeenLastCalledWith(Buffer.concat([
      Buffer.from(directory), Buffer.from(path.sep), entry.name
    ]));
  });

  it('passes directory and stat failures through without suppressing them', () => {
    const entry = { name: 'module.js', ...fileType('isSymbolicLink') };
    const filesystem = fixture([entry]);
    const directoryError = Object.assign(new Error('directory denied'), { code: 'EACCES' });
    filesystem.readdir.mockImplementationOnce((_directory, _options, callback) => callback(directoryError));
    const statError = Object.assign(new Error('stat denied'), { code: 'EACCES' });
    filesystem.lstatSync.mockImplementation(() => { throw statError; });
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const callback = vi.fn();

    filesystem.readdir('root', { withFileTypes: true }, callback);
    expect(callback.mock.calls[0][0]).toBe(directoryError);
    filesystem.readdir('root', { withFileTypes: true }, callback);
    expect(callback.mock.calls[1][0]).toBe(statError);
    expect(() => filesystem.readdirSync('root', { withFileTypes: true })).toThrow(statError);
  });

  it('retains concurrently removed entries for Metro without dropping valid peers', () => {
    const entries = ['removed.js', 'present.js'].map((name) => ({ name, ...fileType('isSymbolicLink') }));
    const filesystem = fixture(entries);
    filesystem.lstatSync.mockImplementationOnce(() => { throw Object.assign(new Error('removed'), { code: 'ENOENT' }); });
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const result = filesystem.readdirSync('root', { withFileTypes: true });
    expect(result[0]).toBe(entries[0]);
    expect(result[1].isFile()).toBe(true);
  });

  it('does not catch or invoke a throwing caller callback twice', () => {
    const filesystem = fixture([{ name: 'module.js', ...fileType('isSymbolicLink') }]);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const callbackError = new Error('caller failure');
    const callback = vi.fn(() => { throw callbackError; });
    expect(() => filesystem.readdir('root', { withFileTypes: true }, callback)).toThrow(callbackError);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('preserves synchronous argument validation when a callback is missing', () => {
    const filesystem = fixture([]);
    const argumentError = Object.assign(new TypeError('callback required'), { code: 'ERR_INVALID_ARG_TYPE' });
    filesystem.readdir.mockImplementation(() => { throw argumentError; });
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    expect(() => filesystem.readdir('root', { withFileTypes: true })).toThrow(argumentError);
    expect(filesystem.lstatSync).not.toHaveBeenCalled();
  });

  it('retains Dirent own metadata and prototype without enumerable type methods', () => {
    const metadata = Symbol('metadata');
    const entry = Object.assign(Object.create(fileType('isSymbolicLink')), {
      name: 'module.js', parentPath: 'nested', [metadata]: 'original'
    });
    const filesystem = fixture([entry]);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const [normalized] = filesystem.readdirSync('root', { withFileTypes: true });
    expect(Object.getPrototypeOf(normalized)).toBe(Object.getPrototypeOf(entry));
    expect({ ...normalized }).toEqual({ ...entry });
    expect(normalized.isFile()).toBe(true);
  });

  it('installs once and leaves other platforms unchanged', () => {
    const filesystem = fixture([]);
    const original = filesystem.readdir;
    installWindowsDirectoryEntryFix(filesystem, 'darwin');
    installWindowsDirectoryEntryFix(filesystem, 'linux');
    expect(filesystem.readdir).toBe(original);
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    const patched = filesystem.readdir;
    installWindowsDirectoryEntryFix(filesystem, 'win32');
    expect(filesystem.readdir).toBe(patched);
  });
});
