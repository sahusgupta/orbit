export type MembershipPlan = 'day' | 'monthly';

export type MembershipWindow = {
  startedAt: Date;
  expiresAt: Date;
  startDate: string;
  expirationDate: string;
};

export function createMembershipWindow(
  plan: MembershipPlan,
  startedAt: Date | string | number = new Date()
): MembershipWindow {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw new Error('Membership start time is invalid.');

  const expiresAt = new Date(start);
  expiresAt.setDate(expiresAt.getDate() + (plan === 'day' ? 1 : 30));

  return {
    startedAt: start,
    expiresAt,
    startDate: start.toISOString().slice(0, 10),
    expirationDate: expiresAt.toISOString().slice(0, 10)
  };
}

export function parseMembershipPrice(value?: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0;
  const amount = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}
