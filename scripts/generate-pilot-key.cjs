const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const privateKeyPath = path.join(process.cwd(), '.pilot-license-private-key.pem');
const brandingPath = path.join(process.cwd(), 'branding.config.json');

function canonicalPayload(payload) {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce((record, key) => {
        record[key] = payload[key];
        return record;
      }, {})
  );
}

function readDerInteger(buffer, offset) {
  if (buffer[offset] !== 0x02) throw new Error('Invalid DER ECDSA signature.');
  const length = buffer[offset + 1];
  const value = buffer.subarray(offset + 2, offset + 2 + length);
  return { value, nextOffset: offset + 2 + length };
}

function leftPad32(buffer) {
  const normalized = buffer[0] === 0 ? buffer.subarray(1) : buffer;
  if (normalized.length > 32) throw new Error('Invalid P-256 signature integer length.');
  return Buffer.concat([Buffer.alloc(32 - normalized.length), normalized]);
}

function derToRawP256Signature(derSignature) {
  if (derSignature[0] !== 0x30) throw new Error('Invalid DER ECDSA signature.');
  const first = readDerInteger(derSignature, 2);
  const second = readDerInteger(derSignature, first.nextOffset);
  return Buffer.concat([leftPad32(first.value), leftPad32(second.value)]);
}

function initKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

  const branding = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));
  branding.license = {
    ...(branding.license ?? {}),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
  };
  fs.writeFileSync(brandingPath, `${JSON.stringify(branding, null, 2)}\n`);
  console.log(`Created ${privateKeyPath}`);
  console.log('Updated branding.config.json with the public key.');
}

function readPrivateKey() {
  const envKey = process.env.PILOT_LICENSE_PRIVATE_KEY_PEM;
  if (envKey) return envKey.replace(/\\n/g, '\n');
  if (fs.existsSync(privateKeyPath)) return fs.readFileSync(privateKeyPath, 'utf8');
  throw new Error('Missing private key. Run `npm run pilot:key:init` first or set PILOT_LICENSE_PRIVATE_KEY_PEM.');
}

function resolvePilotKeyOutputPath(outputDirectory, clubName, requestedFileName = '', exists = fs.existsSync) {
  const fileSafeClub = clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pilot-club';
  const outputFileName = requestedFileName || `${fileSafeClub}-pilot-key.json`;
  const isPlainFileName = path.posix.basename(outputFileName) === outputFileName
    && path.win32.basename(outputFileName) === outputFileName;
  if (!isPlainFileName || !outputFileName.toLowerCase().endsWith('.json')) {
    throw new Error('Pilot key output must be a plain JSON filename in the working directory.');
  }
  const outputPath = path.join(outputDirectory, outputFileName);
  if (exists(outputPath)) {
    throw new Error(`Pilot key output already exists: ${outputPath}`);
  }
  return outputPath;
}

function generateKey() {
  const clubName = process.argv[2] || 'Pilot Club';
  const expiresAt = process.argv[3] || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestedFileName = process.argv[4] || '';
  const payload = {
    authorizationCode: `TT-PILOT-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,
    expiresAt,
    issuedTo: clubName,
    issuedAt: new Date().toISOString(),
    licenseId: `lic_${crypto.randomBytes(8).toString('hex')}`
  };
  const derSignature = crypto.sign('sha256', Buffer.from(canonicalPayload(payload)), readPrivateKey());
  const signature = derToRawP256Signature(derSignature).toString('base64');
  const outputPath = resolvePilotKeyOutputPath(process.cwd(), clubName, requestedFileName);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        version: 1,
        algorithm: 'ECDSA-P256-SHA256',
        payload,
        signature
      },
      null,
      2
    )
  );

  console.log(outputPath);
}

if (require.main === module) {
  if (process.argv[2] === 'init') {
    initKeys();
  } else {
    generateKey();
  }
}

module.exports = {
  canonicalPayload,
  resolvePilotKeyOutputPath
};
