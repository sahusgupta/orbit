const crypto = require('crypto');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

const challengeLifetimeMs = 10 * 60 * 1000;

function normalizeE164(value) {
  const normalized = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) return '';
  return normalized;
}

function challengeSecret() {
  const secret = String(process.env.ORBIT_PHONE_CHALLENGE_SECRET || '').trim();
  return secret.length >= 32 ? secret : '';
}

function phoneHash(phone, secret) {
  return crypto.createHmac('sha256', secret).update(phone).digest('hex');
}

function createChallenge(phone, now = Date.now()) {
  const secret = challengeSecret();
  if (!secret) throw new Error('Player phone verification is not configured.');
  const payload = Buffer.from(JSON.stringify({
    phoneHash: phoneHash(phone, secret),
    expiresAt: now + challengeLifetimeMs,
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: new Date(now + challengeLifetimeMs).toISOString() };
}

function verifyChallenge(token, phone, now = Date.now()) {
  const secret = challengeSecret();
  const [payload, suppliedSignature] = String(token || '').split('.');
  if (!secret || !payload || !suppliedSignature) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return false;
  try {
    const record = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(record.expiresAt) > now && record.phoneHash === phoneHash(phone, secret);
  } catch {
    return false;
  }
}

function twilioVerifyConfig() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const serviceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || '').trim();
  return accountSid && authToken && serviceSid ? { accountSid, authToken, serviceSid } : null;
}

async function twilioVerifyRequest(pathname, fields) {
  const config = twilioVerifyConfig();
  if (!config) throw new Error('Player phone verification is not configured.');
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(config.serviceSid)}/${pathname}`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(fields).toString()
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Phone verification provider rejected the request.');
  return result;
}

async function startPlayerPhoneVerification(request, response) {
  response.set('cache-control', 'no-store');
  const phone = normalizeE164(request.body?.phone);
  if (!phone) {
    response.status(400).json({ ok: false, error: 'Enter a valid phone number including country code.' });
    return;
  }
  if (!twilioVerifyConfig() || !challengeSecret()) {
    response.status(503).json({ ok: false, error: 'Phone verification is unavailable.' });
    return;
  }
  await twilioVerifyRequest('Verifications', { To: phone, Channel: 'sms' });
  const challenge = createChallenge(phone);
  response.status(201).json({ ok: true, challenge: challenge.token, expiresAt: challenge.expiresAt, delivery: 'sms' });
}

async function completePlayerPhoneVerification(request, response) {
  response.set('cache-control', 'no-store');
  const phone = normalizeE164(request.body?.phone);
  const code = String(request.body?.code || '').trim();
  const challenge = String(request.body?.challenge || '').trim();
  if (!phone || !/^\d{4,10}$/.test(code) || challenge.length > 2048 || !verifyChallenge(challenge, phone)) {
    response.status(400).json({ ok: false, error: 'The verification code or challenge is invalid or expired.' });
    return;
  }
  const result = /** @type {{ status?: string }} */ (
    await twilioVerifyRequest('VerificationCheck', { To: phone, Code: code })
  );
  if (result.status !== 'approved') {
    response.status(401).json({ ok: false, error: 'The verification code is invalid or expired.' });
    return;
  }
  const admin = getAdminSdk();
  const firebaseAuth = admin.auth(getAdminApp());
  let user;
  try {
    user = await firebaseAuth.getUserByPhoneNumber(phone);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    user = await firebaseAuth.createUser({ phoneNumber: phone });
  }
  const firebaseToken = await firebaseAuth.createCustomToken(user.uid, { orbitPhoneVerified: true });
  response.json({ ok: true, firebaseToken });
}

module.exports = {
  completePlayerPhoneVerification,
  createChallenge,
  normalizeE164,
  startPlayerPhoneVerification,
  verifyChallenge
};
