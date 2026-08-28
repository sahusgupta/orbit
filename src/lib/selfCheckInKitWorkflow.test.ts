import { describe, expect, it, vi } from 'vitest';
import { runSelfCheckInKitWorkflow } from '../features/settings/selfCheckInKitWorkflow';

const access = {
  authorized: true,
  authorizationCode: 'pilot-code',
  expiresAt: '2027-08-24T12:00:00.000Z',
  activatedAt: '2026-08-24T12:00:00.000Z'
};

describe('self-check-in kit Settings workflow', () => {
  it('authorizes, rotates, applies the committed generation, and reports the saved PDF', async () => {
    const setMessage = vi.fn();
    const applyConfiguration = vi.fn();
    const generateSelfCheckInKit = vi.fn().mockResolvedValue({
      ok: true,
      filePath: 'C:\\Prints\\Orbit-self-check-in.pdf',
      rotatedPreviousCode: true,
      selfCheckIn: { capabilityGeneration: 'generation-two', generatedAt: '2026-08-24T12:01:00.000Z' }
    });

    await runSelfCheckInKitWorkflow({
      access,
      bridge: { generateSelfCheckInKit },
      authorize: vi.fn().mockResolvedValue(true),
      getStaffToken: () => 'staff-token',
      hasExistingCode: true,
      confirmReplacement: () => true,
      setMessage,
      applyConfiguration
    });

    expect(generateSelfCheckInKit).toHaveBeenCalledWith({ access, staffToken: 'staff-token' });
    expect(applyConfiguration).toHaveBeenCalledWith({
      capabilityGeneration: 'generation-two',
      generatedAt: '2026-08-24T12:01:00.000Z'
    });
    expect(setMessage).toHaveBeenLastCalledWith(
      'Previous printed codes were deactivated. Printable self-check-in PDF saved to C:\\Prints\\Orbit-self-check-in.pdf'
    );
  });

  it('does not rotate an existing code without confirmation and handles bridge failures', async () => {
    const setMessage = vi.fn();
    const generateSelfCheckInKit = vi.fn();
    const common = {
      access,
      bridge: { generateSelfCheckInKit },
      authorize: vi.fn().mockResolvedValue(true),
      getStaffToken: () => 'staff-token',
      hasExistingCode: true,
      setMessage,
      applyConfiguration: vi.fn()
    };

    await runSelfCheckInKitWorkflow({ ...common, confirmReplacement: () => false });
    expect(generateSelfCheckInKit).not.toHaveBeenCalled();

    generateSelfCheckInKit.mockRejectedValueOnce(new Error('renderer-safe failure'));
    await runSelfCheckInKitWorkflow({ ...common, hasExistingCode: false, confirmReplacement: () => true });
    expect(setMessage).toHaveBeenLastCalledWith('The self-check-in PDF could not be generated.');
  });
});
