export type ConfirmedPlayerIdentityDetails = {
  fullName: string;
  dateOfBirth: string;
  address: string;
};

export type PlayerIdentityCaptureAttempt = {
  detailsFingerprint: string;
  mutationId: string;
};

function fingerprintConfirmedDetails(details: ConfirmedPlayerIdentityDetails) {
  return JSON.stringify([details.fullName, details.dateOfBirth, details.address]);
}

export function getOrCreateIdentityCaptureAttempt(
  current: PlayerIdentityCaptureAttempt | null,
  details: ConfirmedPlayerIdentityDetails,
  createMutationId: () => string
): PlayerIdentityCaptureAttempt {
  const detailsFingerprint = fingerprintConfirmedDetails(details);
  if (current?.detailsFingerprint === detailsFingerprint) return current;
  return { detailsFingerprint, mutationId: createMutationId() };
}
