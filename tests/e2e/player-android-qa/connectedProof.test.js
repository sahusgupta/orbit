import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { assertConnectedReady, createConnectedServerController } from './connectedProof.mjs';

const fixture = () => ({ type: 'ready', projectId: 'demo-orbit-native-match-qa', apiOrigin: 'http://127.0.0.1:14639', ownerCount: 2, clubId: 'native-qa-card-house', gameIds: ['native-qa-nlh', 'native-qa-plo'], venueRevision: 1, publicationDrained: false });
const child = () => { const ipc = new EventEmitter(); ipc.sent = []; ipc.send = (message, callback) => { ipc.sent.push(message); callback?.(); }; return ipc; };
describe('connected proof IPC handshake', () => {
  it('rejects wrong readiness identity, origin or unreviewed fixture before proof commands', () => {
    expect(() => assertConnectedReady(fixture())).not.toThrow();
    for (const change of [{ projectId: 'tabletalk-s' }, { apiOrigin: 'https://orbitapp-one.vercel.app' }, { ownerCount: 3 }, { clubId: 'foreign' }, { publicationDrained: true }, { venueRevision: 2 }]) expect(() => assertConnectedReady({ ...fixture(), ...change })).toThrow('unexpected server');
  });
  it('correlates replies and permits only bounded owned commands', async () => {
    const ipc = child(), controller = createConnectedServerController(ipc, { timeoutMs: 1000 });
    ipc.emit('message', fixture()); await controller.ready;
    const request = controller.request('peer-read', { owner: 'a' });
    ipc.emit('message', { type: 'result', requestId: 'unrelated', result: 'must-ignore' });
    ipc.emit('message', { type: 'result', requestId: ipc.sent[0].requestId, result: { status: 200 } });
    await expect(request).resolves.toEqual({ status: 200 });
    await expect(controller.request('shell', { owner: 'a' })).rejects.toThrow('unsupported');
    await expect(controller.request('peer-read', { owner: '__proto__' })).rejects.toThrow('unsupported');
    await expect(controller.request('peer-read', { target: 'foreign' })).rejects.toThrow('unsupported');
    await expect(controller.request('peer-operation', { owner: 'a', operation: { value: 'x'.repeat(21 * 1024) } })).rejects.toThrow('too large');
    expect(ipc.sent).toHaveLength(1); controller.dispose();
  });
  it('withholds raw child errors and rejects outstanding operations if its child exits', async () => {
    const ipc = child(), controller = createConnectedServerController(ipc, { timeoutMs: 1000 }); ipc.emit('message', fixture()); await controller.ready;
    const failed = controller.request('peer-read', { owner: 'b' });
    ipc.emit('message', { type: 'error', requestId: ipc.sent[0].requestId, code: 'raw-data-must-not-appear' });
    await expect(failed).rejects.toThrow('raw details withheld');
    const interrupted = controller.request('inspect', { owner: 'a' }); ipc.emit('exit', 1);
    await expect(interrupted).rejects.toThrow('unavailable'); controller.dispose();
  });
  it('requires explicit seat fixture readiness and leaves default mode unable to invoke seat controls', async () => {
    expect(() => assertConnectedReady({...fixture(),fixtureMode:'seat-request'})).toThrow('unexpected server');
    expect(() => assertConnectedReady(fixture(),'seat-request')).toThrow('unexpected server');
    expect(() => assertConnectedReady({...fixture(),fixtureMode:'seat-request'},'seat-request')).not.toThrow();
    expect(() => createConnectedServerController(child(),{fixtureMode:'production'})).toThrow('fixture mode');
    const ipc = child(), controller = createConnectedServerController(ipc,{timeoutMs:1000}); ipc.emit('message',fixture()); await controller.ready;
    await expect(controller.request('fixture-seat-inspect',{owner:'a'})).rejects.toThrow('unsupported');
    expect(ipc.sent).toHaveLength(0); controller.dispose();
  });
  it('bounds opt-in seat controls to owner roles and exact local transitions without request bodies', async () => {
    const ipc = child(), controller = createConnectedServerController(ipc,{timeoutMs:1000,fixtureMode:'seat-request'});
    ipc.emit('message',{...fixture(),fixtureMode:'seat-request'}); await controller.ready;
    const read = controller.request('fixture-seat-inspect',{owner:'a'});
    ipc.emit('message',{type:'result',requestId:ipc.sent[0].requestId,result:{owner:'a',interestCount:0}});
    await expect(read).resolves.toEqual({owner:'a',interestCount:0});
    for (const body of [{owner:'foreign'},{owner:'a',operation:{}},{owner:'a',request:{}},{}, {owner:'b',update:{}}]) await expect(controller.request('peer-seat-replay',body)).rejects.toThrow('unsupported');
    for (const update of [{kind:'delete-account',expectedRevision:1},{kind:'expire-membership',expectedRevision:0},{kind:'end-game',expectedRevision:21},{kind:'end-game',expectedRevision:1,clubId:'foreign'}]) await expect(controller.request('fixture-seat-update',{update})).rejects.toThrow('unsupported');
    expect(ipc.sent).toHaveLength(1); controller.dispose();
  });
});
