export type ScannedGovernmentId = {
  fullName: string;
  dateOfBirth: string;
  address: string;
  age: number | null;
};

const AAMVA_FIELDS = [
  'DAQ', 'DCS', 'DAC', 'DAD', 'DCT', 'DBB', 'DAG', 'DAH', 'DAI', 'DAJ', 'DAK', 'DCG'
] as const;

function cleanValue(value = '') {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function readAamvaField(raw: string, field: typeof AAMVA_FIELDS[number]) {
  const match = new RegExp(`(?:^|[\\r\\n\\u001d\\u001e])(?:DL|ID)?${field}([^\\r\\n\\u001d\\u001e]*)`, 'm').exec(raw);
  return cleanValue(match?.[1]);
}

function isoDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeIdDate(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const firstFour = Number(digits.slice(0, 4));
  if (firstFour >= 1900 && firstFour <= 2200) {
    return isoDate(firstFour, Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  }
  return isoDate(Number(digits.slice(4, 8)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
}

export function calculatePlayerAge(dateOfBirth: string, today = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isoDate(year, month, day)) return null;
  let age = today.getFullYear() - year;
  const birthdayPassed = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function readMagstripeField(value: string, maximumLength: number) {
  const separatorIndex = value.indexOf('^');
  if (separatorIndex >= 0 && separatorIndex <= maximumLength) {
    return [value.slice(0, separatorIndex), value.slice(separatorIndex + 1)] as const;
  }
  return [value.slice(0, maximumLength), value.slice(maximumLength)] as const;
}

function normalizeOcrDate(value: string) {
  const yearFirst = /\b((?:19|20)\d{2})[\s./-]+(\d{1,2})[\s./-]+(\d{1,2})\b/.exec(value);
  if (yearFirst) return isoDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  const monthFirst = /\b(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+((?:19|20)\d{2})\b/.exec(value);
  if (monthFirst) return isoDate(Number(monthFirst[3]), Number(monthFirst[1]), Number(monthFirst[2]));
  const compact = /\b\d{8}\b/.exec(value);
  if (compact) return normalizeIdDate(compact[0]);
  const namedMonth = /\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{1,2})[,]?\s+((?:19|20)\d{2})\b/i.exec(value);
  if (!namedMonth) return '';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months.indexOf(namedMonth[1].slice(0, 3).toUpperCase()) + 1;
  return isoDate(Number(namedMonth[3]), month, Number(namedMonth[2]));
}

function parseMagstripe(raw: string) {
  const trackOne = /%([A-Z]{2})([^?]*)\?/i.exec(raw);
  const trackTwo = /;6\d{5}\d{1,13}=\d{4}(\d{8})(?:\d{1,5}|=)\?/i.exec(raw);
  const [cityValue, afterCity] = readMagstripeField(trackOne?.[2] || '', 13);
  const [nameValue, addressValue] = readMagstripeField(afterCity, 35);
  const nameParts = nameValue.split('$').map(cleanValue).filter(Boolean);
  const [lastName, firstName, suffix] = nameParts;
  const street = cleanValue(addressValue.replace(/\^+$/, '').replace(/\$/g, ', '));
  const city = cleanValue(cityValue);
  const region = cleanValue(trackOne?.[1]);
  return {
    fullName: cleanValue([firstName, lastName, suffix].filter(Boolean).join(' ')),
    dateOfBirth: normalizeIdDate(trackTwo?.[1] || ''),
    address: cleanValue([street, city, region].filter(Boolean).join(', '))
  };
}

export function parseGovernmentIdScan(rawValue: string, today = new Date()): ScannedGovernmentId | null {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const familyName = readAamvaField(raw, 'DCS');
  const firstName = readAamvaField(raw, 'DAC') || readAamvaField(raw, 'DCT');
  const middleName = readAamvaField(raw, 'DAD');
  const magstripe = parseMagstripe(raw);
  const fullName = cleanValue([firstName, middleName, familyName].filter(Boolean).join(' ')) || magstripe.fullName;
  const dateOfBirth = normalizeIdDate(readAamvaField(raw, 'DBB')) || magstripe.dateOfBirth;
  const street = [readAamvaField(raw, 'DAG'), readAamvaField(raw, 'DAH')].filter(Boolean).join(', ') || magstripe.address;
  const city = readAamvaField(raw, 'DAI');
  const region = readAamvaField(raw, 'DAJ');
  const postalCode = readAamvaField(raw, 'DAK').replace(/[^A-Za-z0-9 -]/g, '').trim();
  const country = readAamvaField(raw, 'DCG');
  const locality = cleanValue([city, [region, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  const address = cleanValue([street, locality, country].filter(Boolean).join(', '));
  if (!fullName && !dateOfBirth && !address) return null;
  return { fullName, dateOfBirth, address, age: calculatePlayerAge(dateOfBirth, today) };
}

const OCR_FIELD_LABELS = [
  'LAST NAME', 'SURNAME', 'FAMILY NAME', 'LN',
  'FIRST NAME', 'GIVEN NAMES', 'GIVEN NAME', 'FN',
  'MIDDLE NAME', 'MN', 'NAME',
  'DATE OF BIRTH', 'BIRTH DATE', 'DOB', 'BORN',
  'ADDRESS', 'ADDR'
] as const;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readOcrField(lines: string[], labels: readonly string[]) {
  const labelPattern = labels.map(escapeRegExp).join('|');
  for (let index = 0; index < lines.length; index += 1) {
    const sameLine = new RegExp(`^(?:\\d+[.]?\\s*)?(?:${labelPattern})\\s*[:#-]?\\s+(.+)$`, 'i').exec(lines[index]);
    if (sameLine?.[1]) return cleanValue(sameLine[1]);
    if (new RegExp(`^(?:\\d+[.]?\\s*)?(?:${labelPattern})\\s*[:#-]?$`, 'i').test(lines[index])) {
      const nextLine = cleanValue(lines[index + 1]);
      if (nextLine && !OCR_FIELD_LABELS.some((label) => new RegExp(`^${escapeRegExp(label)}\\b`, 'i').test(nextLine))) {
        return nextLine;
      }
    }
  }
  return '';
}

const cleanOcrName = (value: string) => cleanValue(value.replace(/[^\p{L}' -]+/gu, ' '));

const streetSuffixPattern = '(?:ST(?:REET)?|RD|ROAD|AVE(?:NUE)?|BLVD|BOULEVARD|DR(?:IVE)?|LN|LANE|CT|COURT|CIR(?:CLE)?|HWY|HIGHWAY|PKWY|PARKWAY|PL(?:ACE)?|TER(?:RACE)?|TRL|TRAIL|WAY)';

function readOcrAddress(lines: string[]) {
  let street = readOcrField(lines, ['ADDRESS', 'ADDR']);
  let streetIndex = street ? lines.findIndex((line) => line.includes(street)) : -1;
  if (!street || !new RegExp(`^\\d{1,6}\\s+.+\\b${streetSuffixPattern}\\b`, 'i').test(street)) {
    streetIndex = lines.findIndex((line) =>
      new RegExp(`^\\d{1,6}\\s+[A-Z0-9][A-Z0-9 .#'-]{2,}\\b${streetSuffixPattern}\\b`, 'i').test(line)
    );
    street = streetIndex >= 0 ? lines[streetIndex] : '';
  }
  if (!street) return '';

  const locality = cleanValue(lines[streetIndex + 1]);
  const looksLikeLocality = /(?:,\s*|\s)\b[A-Z]{2}\b(?:\s+\d{5}(?:-\d{4})?|\s+[A-Z]\d[A-Z][ -]?\d[A-Z]\d)?\s*$/i.test(locality);
  return cleanValue([street, looksLikeLocality ? locality : ''].filter(Boolean).join(', '));
}

/**
 * Extracts only profile-safe fields from visible text on an ID image. OCR output is
 * deliberately not returned so license numbers and other raw identity data cannot
 * cross into application state.
 */
export function parseGovernmentIdOcrText(rawValue: string, today = new Date()): ScannedGovernmentId | null {
  const raw = String(rawValue || '').slice(0, 100_000).trim();
  if (!raw) return null;

  const barcodeLike = parseGovernmentIdScan(raw, today);
  if (barcodeLike?.dateOfBirth && (barcodeLike.fullName || barcodeLike.address)) return barcodeLike;

  const lines = raw
    .split(/[\r\n]+/)
    .map((line) => cleanValue(line))
    .filter(Boolean)
    .slice(0, 200);
  const familyName = cleanOcrName(readOcrField(lines, ['LAST NAME', 'SURNAME', 'FAMILY NAME', 'LN']));
  const firstName = cleanOcrName(readOcrField(lines, ['FIRST NAME', 'GIVEN NAMES', 'GIVEN NAME', 'FN']));
  const middleName = cleanOcrName(readOcrField(lines, ['MIDDLE NAME', 'MN']));
  const labeledFullName = cleanOcrName(readOcrField(lines, ['NAME']));
  const fullName = cleanValue([firstName, middleName, familyName].filter(Boolean).join(' ')) || labeledFullName;
  const dateOfBirth = normalizeOcrDate(readOcrField(lines, ['DATE OF BIRTH', 'BIRTH DATE', 'DOB', 'BORN']));
  const address = readOcrAddress(lines);
  const fieldsFound = [fullName, dateOfBirth, address].filter(Boolean).length;
  if (fieldsFound < 2) return null;
  return { fullName, dateOfBirth, address, age: calculatePlayerAge(dateOfBirth, today) };
}
