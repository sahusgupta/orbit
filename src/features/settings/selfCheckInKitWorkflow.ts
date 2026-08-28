import type { ClubSelfCheckInConfiguration, PilotAccess } from '../../domain/types';

type SelfCheckInKitResult = {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  rotatedPreviousCode?: boolean;
  selfCheckIn?: ClubSelfCheckInConfiguration;
  error?: string;
};

type SelfCheckInDesktopBridge = {
  generateSelfCheckInKit?: (payload: { access: PilotAccess; staffToken: string }) => Promise<SelfCheckInKitResult>;
};

type SelfCheckInKitWorkflowOptions = {
  access?: PilotAccess;
  bridge?: SelfCheckInDesktopBridge;
  authorize: () => Promise<boolean>;
  getStaffToken: () => string | undefined;
  hasExistingCode: boolean;
  confirmReplacement: () => boolean;
  setMessage: (message: string) => void;
  applyConfiguration: (configuration: ClubSelfCheckInConfiguration) => void;
};

export const runSelfCheckInKitWorkflow = async ({
  access,
  bridge,
  authorize,
  getStaffToken,
  hasExistingCode,
  confirmReplacement,
  setMessage,
  applyConfiguration
}: SelfCheckInKitWorkflowOptions) => {
  if (!access || !bridge?.generateSelfCheckInKit) {
    setMessage('Printable self-check-in kits require an active licensed Orbit desktop connection.');
    return;
  }
  if (!await authorize()) return;
  const staffToken = getStaffToken();
  if (!staffToken) {
    setMessage('Staff reauthentication is required.');
    return;
  }
  if (hasExistingCode && !confirmReplacement()) return;

  setMessage('Choose where to save the printable PDF...');
  try {
    const result = await bridge.generateSelfCheckInKit({ access, staffToken });
    if (result.selfCheckIn) applyConfiguration(result.selfCheckIn);
    if (result.canceled) {
      setMessage('PDF generation canceled. The current printed code remains active.');
      return;
    }
    if (!result.ok) {
      setMessage(result.error || 'The self-check-in PDF could not be generated.');
      return;
    }
    setMessage(
      `${result.rotatedPreviousCode ? 'Previous printed codes were deactivated. ' : ''}Printable self-check-in PDF saved${result.filePath ? ` to ${result.filePath}` : '.'}`
    );
  } catch {
    setMessage('The self-check-in PDF could not be generated.');
  }
};
