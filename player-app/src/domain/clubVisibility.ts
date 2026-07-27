export function isPlayerVisibleClubName(value: unknown) {
  const name = String(value || '').trim();
  return Boolean(name) && !name.toLocaleLowerCase().includes('stress');
}

export function isPlayerVisibleGameName(value: unknown) {
  const name = String(value || '').trim();
  return Boolean(name) && !name.toLocaleLowerCase().includes('stress');
}
