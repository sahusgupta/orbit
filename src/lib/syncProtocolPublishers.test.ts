import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiPublisherSource = readFileSync(new URL('../../apps/api/src/firebasePublisher.js', import.meta.url), 'utf8');
const rendererPublisherSource = readFileSync(new URL('./firebaseClubSync.ts', import.meta.url), 'utf8');
const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
const rendererPersistenceSource = readFileSync(new URL('../app/persistence/managementPersistence.ts', import.meta.url), 'utf8');
const playerRequestSource = readFileSync(new URL('../../player-app/src/data/firebase/playerRequestRepository.ts', import.meta.url), 'utf8');
const playerRouteSource = readFileSync(new URL('../../apps/api/src/routes/player.js', import.meta.url), 'utf8');
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
    const lastChildWrite = publish.indexOf('const publicationWriteCount = await batchWriteDocuments');
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

  it('leaves renderer and Electron publishers outside runtime state orchestration', () => {
    expect(rendererPersistenceSource).not.toContain('saveClubStateToFirebase');
    expect(electronMainSource).not.toMatch(/(writeStateToFirebase|readStateFromFirebase|fetchPendingPlayerRequests)/);
    expect(rendererPublisherSource).toContain('export async function saveClubStateToFirebase');
  });

  it('routes pending Player mutations through revisioned API state commits', () => {
    expect(playerRequestSource).toContain('submitRemotePlayerRequest');
    expect(playerRequestSource).not.toMatch(/(setDoc|runTransaction|writeRequestToClubPaths)/);
    expect(playerRouteSource).toContain('expectedRevision: record.revision');
    expect(playerRouteSource).toContain('schedulePublicationDrain');
  });

  it('keeps Player hydration responsible for legacy fallback and incomplete revision rejection', () => {
    expect(playerProtocolSource).toContain('export const orbitSyncProtocolVersion = 2;');
    expect(playerProtocolSource).toContain('if (hasStagedVersionedGame) return null;');
    expect(playerProtocolSource).toContain('committedGames.length !== expectedGameCount');
    expect(playerProtocolSource).toContain('return !recordRevision || recordRevision === commit.syncRevision;');
    expect(playerProtocolSource).toContain('recordPublishedAt > committedAt');
  });
});
