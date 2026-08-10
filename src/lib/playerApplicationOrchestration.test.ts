import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const playerSourceRoot = fileURLToPath(new URL('../../player-app/src/', import.meta.url));
const orchestrationRoots = [
  playerSourceRoot,
  join(playerSourceRoot, 'app'),
  join(playerSourceRoot, 'application'),
  join(playerSourceRoot, 'data', 'storage')
];

type ParsedSource = {
  path: string;
  source: string;
  file: ts.SourceFile;
};

function listDirectSourceFiles(root: string) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
    .map((entry) => join(root, entry.name));
}

function parseSources(): ParsedSource[] {
  const paths = Array.from(new Set(orchestrationRoots.flatMap(listDirectSourceFiles)));
  return paths.map((path) => {
    const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    return {
      path,
      source,
      file: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    };
  });
}

function findUseEffectContaining(sources: ParsedSource[], token: string) {
  const matches: string[] = [];
  sources.forEach(({ file }) => {
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'useEffect'
      ) {
        const value = node.getText(file).replace(/\r\n/g, '\n');
        if (value.includes(token)) matches.push(value);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  });
  expect(matches, `${token} should belong to one lifecycle effect`).toHaveLength(1);
  return matches[0];
}

function findVariableFunction(sources: ParsedSource[], name: string) {
  const matches: string[] = [];
  sources.forEach(({ file }) => {
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        matches.push(node.initializer.getText(file).replace(/\r\n/g, '\n'));
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  });
  expect(matches, `${name} should have one application owner`).toHaveLength(1);
  return matches[0];
}

function digest(values: string[]) {
  return createHash('sha256').update(values.join('\n\n')).digest('hex');
}

describe('Player storage and lifecycle orchestration contract', () => {
  it('preserves storage keys, migration priority, normalization, alert persistence, and local-account clearing', () => {
    const sources = parseSources();
    const combined = sources.map(({ source }) => source).join('\n');
    const storageDigest = digest([
      findUseEffectContaining(sources, 'playerStorage.loadPlayer'),
      findUseEffectContaining(sources, 'playerStorage.savePlayer'),
      findUseEffectContaining(sources, 'playerStorage.loadDismissedAlertIds'),
      findVariableFunction(sources, 'dismissInAppAlert'),
      findVariableFunction(sources, 'clearLocalPlayer')
    ]);
    const asyncStorageOwners = sources.filter(({ source }) => source.includes("from '@react-native-async-storage/async-storage'"));
    const nativeApplicationImports = sources.filter(({ path, source }) =>
      path.includes(`${join('src', 'application')}`) && source.includes("from 'react-native'")
    );

    expect(combined).toContain("const legacyPlayerStorageKeys = ['tabletalk-player-account-v1', 'tabletalk-player-account-v2']");
    expect(combined).toContain("const playerStorageKey = 'orbit-player-account-v1'");
    expect(combined).toContain("const dismissedAlertsStorageKey = 'orbit-player-dismissed-alerts-v1'");
    expect(asyncStorageOwners).toHaveLength(1);
    expect(asyncStorageOwners[0].path.endsWith(join('data', 'storage', 'playerStorage.ts'))).toBe(true);
    expect(nativeApplicationImports).toEqual([]);
    expect(storageDigest).toBe('62f74797e9042bd9e213c209b4df13b2ee2b385b60104af45414b2185eb4eb48');
  });

  it('preserves auth/identity, premium, profile, live-club, private-game, and tournament lifecycles', () => {
    const sources = parseSources();
    const lifecycleDigest = digest([
      findUseEffectContaining(sources, 'onFirebasePlayerChanged'),
      findUseEffectContaining(sources, 'fetchPlayerIdentityStatus(forceTokenRefresh)'),
      findUseEffectContaining(sources, 'configureApplePurchases'),
      findUseEffectContaining(sources, 'savePlayerProfile(player)'),
      findUseEffectContaining(sources, 'fetchPlayerProfile()'),
      findUseEffectContaining(sources, 'subscribeToAllClubSnapshots'),
      findUseEffectContaining(sources, 'subscribeToPrivateGameListings'),
      findUseEffectContaining(sources, 'subscribeToPlayerTournaments')
    ]);

    expect(lifecycleDigest).toBe('23eac4ed93c2ae104e8a93077732f8491501917fa514fb71625bf9cca04c6866');
  });
});
