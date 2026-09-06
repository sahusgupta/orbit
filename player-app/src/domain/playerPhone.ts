const e164PhonePattern = /^\+[1-9]\d{9,14}$/;

export const e164PhoneExample = '+1 555 555 0123';
export const e164PhoneRequirement = 'Start with + and the country code.';

export function normalizeE164Phone(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/[\s().-]/g, '');
  return e164PhonePattern.test(normalized) ? normalized : '';
}
