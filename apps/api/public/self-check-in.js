(() => {
  'use strict';

  // Printed name-based check-in is deliberately retired. Remove any capability
  // left by an older page without sending it to the server or storing it.
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.sessionStorage.removeItem('orbit.selfCheckIn.capability');
    window.sessionStorage.removeItem('orbit.selfCheckIn.session');
  } catch {
    // The static retirement notice remains useful if storage/history is blocked.
  }
  document.querySelector('#assistance-heading')?.focus();
})();
