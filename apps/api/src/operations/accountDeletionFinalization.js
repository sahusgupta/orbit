let scheduler;

function registerAccountDeletionFinalizationScheduler(nextScheduler) {
  if (typeof nextScheduler !== 'function') {
    throw new TypeError('An account-deletion finalization scheduler is required.');
  }
  scheduler = nextScheduler;
}

function getAccountDeletionFinalizationScheduler() {
  return scheduler;
}

module.exports = {
  getAccountDeletionFinalizationScheduler,
  registerAccountDeletionFinalizationScheduler
};
