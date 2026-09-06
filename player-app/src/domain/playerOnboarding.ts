import type { PlayerAccount } from './playerSync';

export const adultDeclarationVersion = 'v1' as const;

export function hasAdultDeclaration(player: Pick<PlayerAccount, 'adultDeclaredAt' | 'adultDeclarationVersion'>) {
  return player.adultDeclarationVersion === adultDeclarationVersion &&
    typeof player.adultDeclaredAt === 'string' &&
    Number.isFinite(Date.parse(player.adultDeclaredAt));
}
