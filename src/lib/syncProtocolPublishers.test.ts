import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiPublisherSource = readFileSync(new URL('../../apps/api/src/firebasePublisher.js', import.meta.url), 'utf8');
const electronPublisherSource = readFileSync(new URL('../../electron/firebaseSync.cjs', import.meta.url), 'utf8');
const rendererPublisherSource = readFileSync(new URL('./firebaseClubSync.ts', import.meta.url), 'utf8');
const playerRequestSource = readFileSync(new URL('../../player-app/src/data/firebase/playerRequestRepository.ts', import.meta.url), 'utf8');
const playerProtocolSource = readFileSync(new URL('../../player-app/src/domain/syncProtocol.ts', import.meta.url), 'utf8');

function extractFunctionSource(source: string, file: string, name: string) {
  const exportedAsyncStart = source.indexOf(`export async function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const functionStart = source.indexOf(`function ${name}(`);
  const start = exportedAsyncStart >= 0 ? exportedAsyncStart : asyncStart >= 0 ? asyncStart : functionStart;
  if (start < 0) throw new Error(`Could not find ${name} in ${file}.`);
  const parametersStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf('{', parametersEnd);
  let bodyDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') bodyDepth += 1;
    if (source[index] === '}') bodyDepth -= 1;
    if (bodyDepth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in ${file}.`);
}

describe('sync protocol publisher ownership', () => {
  it('keeps the API REST parent club write after every revisioned child write', () => {
    const publish = extractFunctionSource(
      apiPublisherSource,
      'apps/api/src/firebasePublisher.js',
      'publishStateToFirebase'
    );
    const lastChildWrite = publish.lastIndexOf('`clubs/${encodeURIComponent(accountKey)}/tournamentRegistrations/');
    const parentCommit = publish.indexOf(
      'await patchDocument(projectId, token, `clubs/${encodeURIComponent(accountKey)}`, clubDoc);'
    );
    const result = publish.indexOf('return {', parentCommit);

    expect(lastChildWrite).toBeGreaterThan(0);
    expect(parentCommit).toBeGreaterThan(lastChildWrite);
    expect(result).toBeGreaterThan(parentCommit);
    expect(publish).toContain('syncProtocolVersion: orbitSyncProtocolVersion');
    expect(publish).toContain('syncRevision');
    expect(publish).toContain('// The parent club document is the commit marker.');
  });

  it('keeps renderer and Electron public club writes in one atomic Firestore batch', () => {
    const publishers = [
      {
        file: 'src/lib/firebaseClubSync.ts',
        source: extractFunctionSource(rendererPublisherSource, 'src/lib/firebaseClubSync.ts', 'publishClubSnapshot'),
        sourceName: "syncSource: 'orbit-desktop'"
      },
      {
        file: 'electron/firebaseSync.cjs',
        source: extractFunctionSource(electronPublisherSource, 'electron/firebaseSync.cjs', 'publishClubSnapshot'),
        sourceName: "syncSource: 'orbit-desktop-electron'"
      }
    ];

    for (const publisher of publishers) {
      expect(publisher.source, publisher.file).toContain('const batch = writeBatch(db);');
      expect(publisher.source.match(/batch\.set\(/g)?.length, publisher.file).toBeGreaterThanOrEqual(5);
      expect(publisher.source, publisher.file).toContain("doc(db, 'clubs', accountKey)");
      expect(publisher.source, publisher.file).toContain("doc(db, 'clubs', accountKey, 'games'");
      expect(publisher.source, publisher.file).toContain("doc(db, 'clubs', accountKey, 'memberships'");
      expect(publisher.source, publisher.file).toContain("doc(db, 'clubs', accountKey, 'waitlists'");
      expect(publisher.source, publisher.file).toContain(publisher.sourceName);
      expect(publisher.source.match(/await batch\.commit\(\)/g), publisher.file).toHaveLength(1);
      expect(publisher.source, publisher.file).not.toMatch(/await batch\.set\(/);
    }
  });

  it('keeps pending request writes, reads, and acknowledgements scoped to both current and legacy club paths', () => {
    const rendererFetch = extractFunctionSource(
      rendererPublisherSource,
      'src/lib/firebaseClubSync.ts',
      'fetchPendingRequestDocs'
    );
    const rendererMark = extractFunctionSource(
      rendererPublisherSource,
      'src/lib/firebaseClubSync.ts',
      'markRequestApplied'
    );
    const electronFetch = extractFunctionSource(
      electronPublisherSource,
      'electron/firebaseSync.cjs',
      'fetchPendingPlayerRequests'
    );
    const electronMark = extractFunctionSource(
      electronPublisherSource,
      'electron/firebaseSync.cjs',
      'markPlayerRequestApplied'
    );
    const playerWrite = extractFunctionSource(
      playerRequestSource,
      'player-app/src/data/firebase/playerRequestRepository.ts',
      'writeRequestToClubPaths'
    );

    for (const source of [rendererFetch, rendererMark, electronFetch, electronMark]) {
      expect(source).toContain("'clubs', accountKey");
      expect(source).toContain("'clubStates', accountKey");
    }
    expect(playerWrite).toContain("'clubs', clubId");
    expect(playerWrite).toContain("'clubStates', clubId");
    expect(playerWrite).toContain('clientMutationId: requestId');
    expect(playerWrite).toContain('syncProtocolVersion: orbitSyncProtocolVersion');
  });

  it('keeps Player hydration responsible for legacy fallback and incomplete revision rejection', () => {
    expect(playerProtocolSource).toContain('export const orbitSyncProtocolVersion = 2;');
    expect(playerProtocolSource).toContain('if (hasStagedVersionedGame) return null;');
    expect(playerProtocolSource).toContain('committedGames.length !== expectedGameCount');
    expect(playerProtocolSource).toContain('return !recordRevision || recordRevision === commit.syncRevision;');
    expect(playerProtocolSource).toContain('recordPublishedAt > committedAt');
  });
});
