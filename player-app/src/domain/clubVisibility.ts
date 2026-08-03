export function isPlayerVisibleClubName(value: unknown) {
  const name = String(value || '').trim();
  const normalizedName = name.toLocaleLowerCase();
  return Boolean(name) && normalizedName !== 'test club' && !normalizedName.includes('stress');
}

export function isPlayerVisibleGameName(value: unknown) {
  const name = String(value || '').trim();
  return Boolean(name) && !name.toLocaleLowerCase().includes('stress');
}
