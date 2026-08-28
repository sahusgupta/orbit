export function getUnconfirmedCheckoutReturnMessage(clubName: string) {
  return `Checkout window closed. Payment is not confirmed in Orbit yet. Access updates only after Stripe and ${clubName} confirm it.`;
}
