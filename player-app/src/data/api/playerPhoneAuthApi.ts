import { requestJson } from './boundedFetch';
import { orbitApiBaseUrl } from './playerHttpApi';

function readResponse(response: Response, body: unknown, fallback: string) {
  if (!response.ok || !body || typeof body !== 'object') {
    const message = body && typeof body === 'object' && typeof Reflect.get(body, 'error') === 'string'
      ? String(Reflect.get(body, 'error'))
      : fallback;
    throw new Error(message);
  }
  return body;
}

export async function requestPlayerPhoneCode(phone: string) {
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/auth/phone/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  const body = readResponse(response, payload, 'Unable to send a verification code.');
  const challenge = Reflect.get(body, 'challenge');
  const expiresAt = Reflect.get(body, 'expiresAt');
  if (typeof challenge !== 'string' || typeof expiresAt !== 'string') throw new Error('Phone verification returned an invalid response.');
  return { challenge, expiresAt };
}

export async function exchangePlayerPhoneCode(phone: string, code: string, challenge: string) {
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/auth/phone/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code, challenge })
  });
  const body = readResponse(response, payload, 'Unable to verify the phone number.');
  const firebaseToken = Reflect.get(body, 'firebaseToken');
  if (typeof firebaseToken !== 'string' || !firebaseToken) throw new Error('Phone verification returned an invalid response.');
  return firebaseToken;
}
