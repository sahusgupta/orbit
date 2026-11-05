import type { Session } from 'node:inspector/promises';

/** Await the real App save boundary already captured by its rendered handlers. */
export async function waitForCapturedManagementSaves(session: Session, handlerObjectId: string): Promise<void> {
  const properties = await session.post('Runtime.getProperties', { objectId: handlerObjectId, ownProperties: false });
  const scopesId = properties.internalProperties?.find((property) => property.name === '[[Scopes]]')?.value?.objectId;
  if (!scopesId) throw new Error('Expected management handler closure scopes.');
  const scopes = await session.post('Runtime.getProperties', { objectId: scopesId, ownProperties: true });
  for (const scope of scopes.result) {
    if (!scope.value?.objectId) continue;
    const bindings = await session.post('Runtime.getProperties', { objectId: scope.value.objectId, ownProperties: true });
    const wait = bindings.result.find((binding) => binding.name === 'waitForPendingManagementSaves')?.value;
    if (wait?.type !== 'function' || !wait.objectId) continue;
    const settled = await session.post('Runtime.callFunctionOn', {
      objectId: wait.objectId,
      functionDeclaration: 'function () { return this(); }',
      awaitPromise: true,
      returnByValue: true
    });
    if (settled.exceptionDetails) throw new Error(settled.exceptionDetails.text);
    return;
  }
  throw new Error('Expected the actual pending-management-save boundary in the captured App closure.');
}
