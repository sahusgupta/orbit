const publicSiteBaseUrl = 'https://orbitapp-one.vercel.app';

export function readPublicHttpsUrl(value: string | undefined, fallback: string) {
  try {
    if (!value) return fallback;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export const privacyPolicyUrl = readPublicHttpsUrl(
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  `${publicSiteBaseUrl}/privacy`
);
export const termsOfServiceUrl = readPublicHttpsUrl(
  process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL,
  `${publicSiteBaseUrl}/terms`
);
export const supportUrl = readPublicHttpsUrl(
  process.env.EXPO_PUBLIC_SUPPORT_URL,
  `${publicSiteBaseUrl}/support`
);
