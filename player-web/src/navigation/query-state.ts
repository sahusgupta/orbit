export function readRouteQuery(pathname: string, fallback: Pick<URLSearchParams, 'toString'>) {
  // Next updates its search-parameter snapshot in a transition. The current
  // browser URL already contains any filter edit made before that render.
  return new URLSearchParams(window.location.pathname === pathname ? window.location.search : fallback.toString());
}

export function replaceRouteQuery(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();
  window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
}
