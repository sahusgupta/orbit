export function replaceRouteQuery(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();
  window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
}
