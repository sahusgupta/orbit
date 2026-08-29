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
