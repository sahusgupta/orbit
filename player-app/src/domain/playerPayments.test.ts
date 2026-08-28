import { describe, expect, it } from 'vitest';
import { getUnconfirmedCheckoutReturnMessage } from './playerPayments';

describe('player checkout return copy', () => {
  it('treats browser closure as unconfirmed rather than completed payment', () => {
    const message = getUnconfirmedCheckoutReturnMessage('River Room');
    expect(message).toContain('not confirmed');
    expect(message).toContain('Stripe and River Room confirm it');
    expect(message.toLowerCase()).not.toContain('checkout completed');
    expect(message.toLowerCase()).not.toContain('payment complete');
  });
});
