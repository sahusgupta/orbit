import { describe, expect, it, vi } from 'vitest';
import { commitAuthoritativeTransition } from './authoritativeTransition';

type TestSession = { id: string; leftAt?: string };
type TestState = { playerSessions: TestSession[]; marker: string };

const closeTarget = (state: TestState): TestState => {
  const target = state.playerSessions.find((session) => session.id === 'target' && !session.leftAt);
  if (!target) return state;
  return {
    ...state,
    playerSessions: state.playerSessions.map((session) =>
      session.id === target.id ? { ...session, leftAt: '2026-08-26T22:00:00.000Z' } : session
    )
  };
};

describe('authoritative management transitions', () => {
  it('reloads and reapplies a checkout after a revision conflict without dropping a concurrent QR seat', async () => {
    const initial: TestState = { marker: 'initial', playerSessions: [{ id: 'target' }] };
    const authoritative: TestState = {
      marker: 'remote',
      playerSessions: [{ id: 'target' }, { id: 'qr-arrival' }]
    };
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, conflict: true, error: 'revision conflict' })
      .mockResolvedValueOnce({ ok: true });
    const loadAuthoritative = vi.fn().mockResolvedValue(authoritative);

    const result = await commitAuthoritativeTransition({
      initialState: initial,
      transition: closeTarget,
      save,
      loadAuthoritative
    });

    expect(result).toMatchObject({ ok: true, retried: true, adoptedAuthoritative: false });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toEqual({
      marker: 'initial',
      playerSessions: [{ id: 'target', leftAt: '2026-08-26T22:00:00.000Z' }]
    });
    expect(save.mock.calls[1][0]).toEqual({
      marker: 'remote',
      playerSessions: [
        { id: 'target', leftAt: '2026-08-26T22:00:00.000Z' },
        { id: 'qr-arrival' }
      ]
    });
  });

  it('adopts a fresh authoritative state when the transition was already committed elsewhere', async () => {
    const initial: TestState = { marker: 'initial', playerSessions: [{ id: 'target' }] };
    const authoritative: TestState = {
      marker: 'remote',
      playerSessions: [{ id: 'target', leftAt: '2026-08-26T21:59:00.000Z' }]
    };
    const save = vi.fn().mockResolvedValue({ ok: false, conflict: true });

    const result = await commitAuthoritativeTransition({
      initialState: initial,
      transition: closeTarget,
      save,
      loadAuthoritative: vi.fn().mockResolvedValue(authoritative)
    });

    expect(result).toMatchObject({
      ok: true,
      state: authoritative,
      retried: true,
      adoptedAuthoritative: true
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not reload for a successful save or a non-conflict failure', async () => {
    const initial: TestState = { marker: 'initial', playerSessions: [{ id: 'target' }] };
    const loadAuthoritative = vi.fn();

    const success = await commitAuthoritativeTransition({
      initialState: initial,
      transition: closeTarget,
      save: vi.fn().mockResolvedValue({ ok: true }),
      loadAuthoritative
    });
    const unavailable = await commitAuthoritativeTransition({
      initialState: initial,
      transition: closeTarget,
      save: vi.fn().mockResolvedValue({ ok: false, error: 'offline' }),
      loadAuthoritative
    });

    expect(success).toMatchObject({ ok: true, retried: false });
    expect(unavailable).toMatchObject({ ok: false, retried: false, error: 'offline' });
    expect(loadAuthoritative).not.toHaveBeenCalled();
  });

  it('reloads once more after a retry conflict so rollback does not use an older revision', async () => {
    const initial: TestState = { marker: 'initial', playerSessions: [{ id: 'target' }] };
    const firstAuthoritative: TestState = {
      marker: 'first-authoritative',
      playerSessions: [{ id: 'target' }, { id: 'first-qr-arrival' }]
    };
    const latestAuthoritative: TestState = {
      marker: 'latest-authoritative',
      playerSessions: [
        { id: 'target' },
        { id: 'first-qr-arrival' },
        { id: 'second-qr-arrival' }
      ]
    };
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, conflict: true, error: 'first revision conflict' })
      .mockResolvedValueOnce({ ok: false, conflict: true, error: 'second revision conflict' });
    const loadAuthoritative = vi.fn()
      .mockResolvedValueOnce(firstAuthoritative)
      .mockResolvedValueOnce(latestAuthoritative);

    const result = await commitAuthoritativeTransition({
      initialState: initial,
      transition: closeTarget,
      save,
      loadAuthoritative
    });

    expect(result).toMatchObject({
      ok: false,
      state: latestAuthoritative,
      retried: true,
      conflict: true,
      error: 'second revision conflict'
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(loadAuthoritative).toHaveBeenCalledTimes(2);
  });
});
