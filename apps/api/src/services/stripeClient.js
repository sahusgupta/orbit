/**
 * @typedef {object} StripeClientProviderOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {() => unknown} [loadStripe]
 */

/** @param {StripeClientProviderOptions} [options] */
function createStripeClientProvider(options = {}) {
  const {
    env = process.env,
    loadStripe = () => require('stripe')
  } = options;
  /** @type {import('stripe').default | undefined} */
  let stripeClient;
  /** @type {typeof import('stripe').default | undefined} */
  let stripeConstructor;

  function getStripeConstructor() {
    if (stripeConstructor) return stripeConstructor;
    const loaded = /** @type {typeof import('stripe')} */ (loadStripe());
    stripeConstructor = /** @type {typeof import('stripe').default} */ (
      loaded.Stripe || loaded.default || loaded
    );
    return stripeConstructor;
  }

  function getStripe() {
    if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured.');
    const Stripe = getStripeConstructor();
    stripeClient = stripeClient || new Stripe(env.STRIPE_SECRET_KEY);
    return stripeClient;
  }

  return { getStripe, getStripeConstructor };
}

const stripeClientProvider = createStripeClientProvider();

module.exports = {
  createStripeClientProvider,
  getStripe: stripeClientProvider.getStripe,
  getStripeConstructor: stripeClientProvider.getStripeConstructor
};
