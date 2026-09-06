const appFunctionality = 'NSPrivacyCollectedDataTypePurposeAppFunctionality';
const productPersonalization = 'NSPrivacyCollectedDataTypePurposeProductPersonalization';

function reviewedDataType(type, purposes = [appFunctionality]) {
  return Object.freeze({
    NSPrivacyCollectedDataType: type,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: Object.freeze([...purposes])
  });
}

// This is the conservative app-owned disclosure for repository-controlled
// collection. SDK-owned declarations remain an exact signed-archive gate.
export const reviewedPlayerCollectedDataTypes = Object.freeze([
  reviewedDataType('NSPrivacyCollectedDataTypeName'),
  reviewedDataType('NSPrivacyCollectedDataTypeEmailAddress'),
  reviewedDataType('NSPrivacyCollectedDataTypePhoneNumber'),
  reviewedDataType('NSPrivacyCollectedDataTypePhysicalAddress'),
  reviewedDataType('NSPrivacyCollectedDataTypeCoarseLocation', [appFunctionality, productPersonalization]),
  reviewedDataType('NSPrivacyCollectedDataTypeOtherUserContent', [appFunctionality, productPersonalization]),
  reviewedDataType('NSPrivacyCollectedDataTypeUserID'),
  reviewedDataType('NSPrivacyCollectedDataTypePurchaseHistory'),
  reviewedDataType('NSPrivacyCollectedDataTypeProductInteraction', [appFunctionality, productPersonalization]),
  reviewedDataType('NSPrivacyCollectedDataTypeOtherDataTypes')
]);

export const reviewedPlayerPrivacyEntryKeys = Object.freeze([
  'NSPrivacyCollectedDataType',
  'NSPrivacyCollectedDataTypeLinked',
  'NSPrivacyCollectedDataTypePurposes',
  'NSPrivacyCollectedDataTypeTracking'
]);
