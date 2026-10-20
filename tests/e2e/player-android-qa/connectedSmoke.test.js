import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createConnectedVenueState, connectedFixtureAccounts } from './connectedServer.mjs';
import { decodePlayerClubSnapshot } from '../../../player-app/src/domain/decoders/playerBoundaryDecoders';
import { buildMatchCandidates, rankMatchCandidates } from '../../../player-app/src/domain/orbitMatchCandidates';
import { defaultMatchPreferences } from '../../../player-app/src/domain/orbitMatchTypes';
import { getClubFeeProfile } from '../../../player-app/src/domain/clubAccess';
import { assertConnectedApkPath, assertConnectedArtifact, assertConnectedBootstrap, assertConnectedReverses, assertSeatInspection, connectedAdbArguments, connectedNativeTarget, connectedReverseArguments, connectedSmokeMode, findSeatSystemUiWait, parseConnectedDiagnostics, verifyRejectedSeatUi } from './connectedSmoke.mjs';

const source = 'fbd9caea8f7f0786c4c0ba9b85f1ddbfcb427edec673fe2493f1bf59976c83f5';
const digest = 'a'.repeat(64); const fixture = 'b'.repeat(64);
const baseDiagnostic = () => ({ kind: 'journal-durable', ownerRole: 'a', revision: 4, preferencesRevision: 1, savedCount: 0, passedCount: 0, variants: ['nlh'], preferredTime: 'any', pending: [{mutationId:'qa_mutation_1',type:'decide'}] });
const log = record => `10-13 00:00:00 I ReactNativeJS: ORBIT_CONNECTED_QA ${JSON.stringify(record)}`;
const { buildPlayerClubSnapshot } = createRequire(import.meta.url)('../../../apps/api/src/shared/orbitCore.cjs');

describe('separate connected Android QA boundaries', () => {
  it('scrolls to the retained arrival control when additional Saved rows put it below the viewport', async () => {
    const cancel = { package:connectedNativeTarget.package,'content-desc':'Cancel request for $2/$5 Pot Limit Omaha',enabled:'true',clickable:'true',rect:[81,2302,245,2166] };
    const nodes = [{package:connectedNativeTarget.package,text:'My Games',rect:[47,1814,933,1879]},cancel];
    const visible = node => node?.rect[0] >= 0 && node.rect[1] >= 0 && node.rect[2] <= 1080 && node.rect[3] <= 2400 && node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1];
    const find = selector => nodes.find(node => (node.text === selector || node['content-desc'] === selector) && visible(node));
    const seek = vi.fn(async (selector, options) => {
      if (selector === cancel['content-desc']) cancel.rect = [81,1800,245,1916];
      const node = find(selector);
      if (!node || options?.press && (node.enabled !== 'true' || node.clickable !== 'true' || (node.rect[3]-node.rect[1])/2.625 < 40)) throw new Error('Control not visible after bounded scroll');
      return node;
    });
    const waitFor = async selector => { const node = find(selector); if (!node) throw new Error('Control is clipped below viewport'); return node; };
    const capture = vi.fn();
    await verifyRejectedSeatUi({seek,waitFor,ui:() => nodes,capture});
    expect(seek).toHaveBeenCalledWith(cancel['content-desc'], {press:true});
    expect(capture).toHaveBeenCalledWith('seat-my-games-after-rejection');
  });
  it('rejects an owned optimistic Holdem residue before capturing rejection success', async () => {
    const nodes = [{package:connectedNativeTarget.package,'content-desc':'Cancel request for $1/$2 No Limit Holdem'}];
    const capture = vi.fn();
    await expect(verifyRejectedSeatUi({seek:vi.fn(),waitFor:vi.fn(),ui:() => nodes,capture})).rejects.toThrow('Rejected Holdem');
    expect(capture).not.toHaveBeenCalled();
  });
  it('keeps the existing Match fixture default and requires separate opt-in seat-request approval', () => {
    expect(connectedSmokeMode(new Set(['--run','--fresh']),undefined)).toBe('match');
    expect(connectedSmokeMode(new Set(['--run','--seat-request','--install','--fresh']),'1')).toBe('seat-request');
    for (const options of [new Set(['--seat-request']),new Set(['--run','--seat-request','--package']),new Set(['--run','--profile'])]) expect(() => connectedSmokeMode(options,'1')).toThrow();
    expect(() => connectedSmokeMode(new Set(['--run','--seat-request']),undefined)).toThrow('separate root approval');
  });
  it('accepts only bounded exact noncontact owned request/conversion inspection fields', () => {
    const empty = {fixtureMode:'seat-request',venueRevision:1,waitlistAttemptCount:0,interestCount:0,interests:[],receiptCount:0,match:{savedCount:0,waitlistSuccessEvents:[]}};
    expect(assertSeatInspection(empty)).toBe(empty);
    const interest = {id:'wait_qa_request',gameId:'native-qa-plo',tableId:'native-qa-table-1',status:'Arrived',attendance:'arrived',requestedAt:'2026-10-13T08:00:00.000Z'};
    const event = {eventId:'match_qa_event',at:'2026-10-13T08:00:01.000Z',ref:{clubId:'native-qa-card-house',gameId:'native-qa-plo',kind:'cash'},saveMutationId:'match_qa_save'};
    const accepted = {...empty,venueRevision:2,waitlistAttemptCount:1,interestCount:1,interests:[interest],receiptCount:1,match:{savedCount:1,waitlistSuccessEvents:[event]}};
    expect(assertSeatInspection(accepted)).toBe(accepted);
    for (const change of [{fixtureMode:'match'},{venueRevision:0},{token:'must-not-log'},{identity:{}},{interestCount:2},{interests:[{...interest,email:'must-not-log'}]},{interests:[{...interest,gameId:'foreign'}]},{interests:[{...interest,tableId:'foreign'}]},{interests:[{...interest,status:'Seated'}]},{interests:[{...interest,requestedAt:'invalid'}]},{match:{savedCount:1,waitlistSuccessEvents:[{...event,ref:{...event.ref,clubId:'foreign'}}]}},{match:{savedCount:1,waitlistSuccessEvents:[{...event,verifiedDetails:{}}]}},{match:{savedCount:1,waitlistSuccessEvents:Array.from({length:11},()=>event)}}]) expect(() => assertSeatInspection({...accepted,...change})).toThrow('noncontact');
  });
  it('captures only bounded ordered bootstrap timings independent of readiness without raw payload fields', () => {
    const start = {type:'bootstrap',phase:'start',elapsedMs:0};
    expect(assertConnectedBootstrap(start)).toEqual({phase:'start',elapsedMs:0});
    expect(assertConnectedBootstrap({type:'bootstrap',phase:'ready',elapsedMs:31_000},{phase:'api-listening',elapsedMs:100})).toEqual({phase:'ready',elapsedMs:31_000});
    for (const change of [{phase:'foreign'},{elapsedMs:-1},{elapsedMs:0.5},{elapsedMs:3_600_001},{body:{}},{token:'must-not-log'},{email:'must-not-log'},{headers:{}}]) expect(() => assertConnectedBootstrap({...start,...change})).toThrow('phase timings');
    expect(() => assertConnectedBootstrap(start,{phase:'ready',elapsedMs:20})).toThrow('phase timings');
    expect(() => assertConnectedBootstrap({type:'bootstrap',phase:'ready',elapsedMs:19},{phase:'api-listening',elapsedMs:20})).toThrow('phase timings');
  });
  it('allows only the exact observed System UI Wait recovery and rejects other OS dialogs/actions', () => {
    const title = {package:'android','resource-id':'android:id/alertTitle',text:"System UI isn't responding"};
    const wait = {package:'android','resource-id':'android:id/aerr_wait',text:'Wait',class:'android.widget.Button',enabled:'true',clickable:'true',rect:[70,1304,1010,1430]};
    expect(findSeatSystemUiWait([title,wait],1080,2400)).toBe(wait);
    for (const nodes of [[wait],[{...title,text:"Orbit Player isn't responding"},wait],[{...title,package:'foreign'},wait],[title,{...wait,text:'Close app','resource-id':'android:id/aerr_close'}],[title,{...wait,package:'foreign'}],[title,{...wait,enabled:'false'}],[title,{...wait,rect:[0,0,1200,3000]}],[title,wait,wait],[title,title,wait]]) expect(() => findSeatSystemUiWait(nodes,1080,2400)).toThrow('exact observed');
  });
  it('retains actual Time-rate inventory with factual unknown pricing through projection, decoding and ranking', () => {
    const state = createConnectedVenueState(); delete state.settings.defaultHourlyFee;
    const player = {...connectedFixtureAccounts.a,preferredGameIds:[]};
    const raw = buildPlayerClubSnapshot(state,player);
    expect(raw.timeAccess.enabled).toBe(true); expect(raw.timeAccess.hourlyFeeCents).toBeUndefined();
    const club = decodePlayerClubSnapshot(raw); expect(club).not.toBeNull(); expect(club.games).toHaveLength(2);
    expect(club.timeAccess.hourlyFeeCents).toBeUndefined();
    expect(getClubFeeProfile(club,club.games[0]).label).toBe('Time rate not published');
    const candidates = buildMatchCandidates({clubs:[club],player,activeGameKeys:new Set(),nowMs:Date.now(),origin:null});
    const ranked = rankMatchCandidates({candidates,preferences:defaultMatchPreferences,decisions:[]});
    expect(ranked).toHaveLength(2); expect(ranked[0].ref.gameId).toBe('native-qa-plo');
  });
  it('keeps an explicit synthetic published rate playable through production decoders and ranking', () => {
    const player = {...connectedFixtureAccounts.a,preferredGameIds:[]};
    const state = createConnectedVenueState(); state.settings.defaultHourlyFee = 10;
    const raw = buildPlayerClubSnapshot(state,player);
    const club = decodePlayerClubSnapshot(raw);
    expect(club).not.toBeNull(); expect(club.games).toHaveLength(2);
    expect(club.timeAccess.hourlyFeeCents).toBe(1000);
    const candidates = buildMatchCandidates({clubs:[club],player,activeGameKeys:new Set(),nowMs:Date.now(),origin:null});
    expect(candidates.map(candidate => candidate.status)).toEqual(['live','live']);
    expect(rankMatchCandidates({candidates,preferences:defaultMatchPreferences,decisions:[]})).toHaveLength(2);
  });
  it('continues rejecting malformed present hourly fees at the actual fixture decoding boundary', () => {
    const raw = buildPlayerClubSnapshot(createConnectedVenueState(),{...connectedFixtureAccounts.a,preferredGameIds:[]});
    for (const hourlyFeeCents of [null,-1,NaN,Infinity,'1000',{}]) {
      expect(decodePlayerClubSnapshot({...raw,timeAccess:{...raw.timeAccess,hourlyFeeCents}})).toBeNull();
    }
  });
  it('pins the dedicated emulator/ADB port and separate package', () => {
    expect(connectedNativeTarget).toEqual({package:'com.orbit.player.qa.connected',activity:'com.orbit.player.qa.connected/.MainActivity',serial:'emulator-5580',port:'5039'});
    expect(Object.isFrozen(connectedNativeTarget)).toBe(true);
    expect(connectedAdbArguments(['shell','am','force-stop',connectedNativeTarget.package])).toEqual(['-P','5039','-s','emulator-5580','shell','am','force-stop','com.orbit.player.qa.connected']);
  });
  it('allows only the three explicit local service reverse mappings and individual removal', () => {
    for (const port of [19099,18085,14639]) {
      expect(connectedReverseArguments(port)).toEqual(['reverse',`tcp:${port}`,`tcp:${port}`]);
      expect(connectedReverseArguments(port,true)).toEqual(['reverse','--remove',`tcp:${port}`]);
    }
    for (const port of [5037,5039,8080,9099,443,'14639']) expect(() => connectedReverseArguments(port)).toThrow();
  });
  it('checks the actual reverse list after setup and rejects extra, duplicate or redirected ports', () => {
    const rows = [19099,18085,14639].map(port => `emulator-5580 tcp:${port} tcp:${port}`);
    expect(assertConnectedReverses(rows.join('\n'))).toBe(true);
    expect(assertConnectedReverses('',[])).toBe(true);
    for (const output of ['',rows.slice(1).join('\n'),[...rows,'emulator-5580 tcp:9999 tcp:9999'].join('\n'),[rows[0],rows[0],rows[2]].join('\n'),rows.join('\n').replace('tcp:18085 tcp:18085','tcp:18085 tcp:8080')]) expect(() => assertConnectedReverses(output)).toThrow();
  });
  it('requires matching root-approved APK, original source and frozen fixture hashes', () => {
    const metadata = {appId:connectedNativeTarget.package,sha256:digest,source:{sha256:source,files:128},fixture:{sha256:fixture}};
    expect(() => assertConnectedArtifact(metadata,digest,digest,fixture,source)).not.toThrow();
    for (const candidate of [{...metadata,appId:'com.orbit.player'},{...metadata,source:{sha256:digest,files:128}},{...metadata,source:{sha256:source,files:129}},{...metadata,fixture:{sha256:digest}},{...metadata,sha256:fixture}]) expect(() => assertConnectedArtifact(candidate,digest,digest,fixture,source)).toThrow();
    expect(() => assertConnectedArtifact(metadata,digest,fixture,fixture,source)).toThrow();
    expect(() => assertConnectedArtifact(metadata,digest,digest,undefined,source)).toThrow();
    expect(() => assertConnectedArtifact(metadata,digest,digest,fixture,undefined)).toThrow();
  });
  it('pins only the short copied-project APK and rejects path aliases or arbitrary siblings', () => {
    const expected = path.resolve('out/c/player-app/android/app/build/outputs/apk/release/app-release.apk');
    expect(assertConnectedApkPath(expected,expected)).toBe(expected);
    expect(() => assertConnectedApkPath(path.resolve('out/player-android-qa/project/player-app/android/app/build/outputs/apk/release/app-release.apk'),expected)).toThrow();
    expect(() => assertConnectedApkPath(expected,path.resolve('out/other.apk'))).toThrow();
  });
  it('retains only reviewed post-operation counts and mutation IDs from sanitized native diagnostics', () => {
    const record = baseDiagnostic();
    expect(parseConnectedDiagnostics(`unrelated harmless line\n${log(record)}`)).toEqual([record]);
    expect(parseConnectedDiagnostics(log({...record,kind:'listener-accepted',pending:undefined,listener:2,accepted:3}))).toHaveLength(1);
    expect(parseConnectedDiagnostics(log({...record,kind:'http-mutation',pending:undefined,mutationId:'qa_accepted',operationType:'preferences'}))).toHaveLength(1);
  });
  it('rejects token/body/coordinate/profile fields and malformed or unbounded diagnostics', () => {
    for (const change of [{token:'sensitive'},{body:{}},{email:'fixture@example.invalid'},{coordinate:{latitude:0,longitude:0}},{ownerRole:'production'},{revision:-1},{savedCount:1.5},{variants:['unknown']},{preferredTime:'overnight'},{pending:[{mutationId:'bad id',type:'decide'}]},{pending:[{mutationId:'valid',type:'delete-account'}]},{pending:[{mutationId:'valid',type:'decide',payload:{}}]}]) expect(() => parseConnectedDiagnostics(log({...baseDiagnostic(),...change}))).toThrow();
    expect(() => parseConnectedDiagnostics('ORBIT_CONNECTED_QA not-json')).toThrow(/Malformed/);
    expect(() => parseConnectedDiagnostics(Array.from({length:2001},()=>log(baseDiagnostic())).join('\n'))).toThrow(/bound/);
  });
});
