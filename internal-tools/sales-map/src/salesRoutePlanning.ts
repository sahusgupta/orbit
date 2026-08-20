import { TEXAS_CITY_COORDINATES } from './texasMapGeometry';
import { texasVenues, type TexasVenue } from './texasVenues';

export type WeightedRouteVenue = Readonly<{
  weight: number;
}>;

type CatalogVenue = Readonly<{
  catalogIndex: number;
  venue: TexasVenue;
}>;

const catalogVenueById = new Map<string, CatalogVenue>(
  texasVenues.map((venue, catalogIndex) => [venue.id, { catalogIndex, venue }])
);

const compareIds = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

const assertAndResolveRoute = (routeVenueIds: readonly string[]): CatalogVenue[] => {
  const seenIds = new Set<string>();

  return routeVenueIds.map((venueId) => {
    const catalogVenue = catalogVenueById.get(venueId);
    if (!catalogVenue) {
      throw new RangeError(`Unknown Texas venue ID in route: ${venueId}`);
    }
    if (seenIds.has(venueId)) {
      throw new RangeError(`Duplicate Texas venue ID in route: ${venueId}`);
    }

    seenIds.add(venueId);
    return catalogVenue;
  });
};

const degreesToRadians = (degrees: number) => degrees * Math.PI / 180;

/** Returns the great-circle angular distance between two catalog venues. */
const getVenueDistance = (left: TexasVenue, right: TexasVenue) => {
  const leftCoordinate = TEXAS_CITY_COORDINATES[left.city];
  const rightCoordinate = TEXAS_CITY_COORDINATES[right.city];
  const leftLatitude = degreesToRadians(leftCoordinate.latitude);
  const rightLatitude = degreesToRadians(rightCoordinate.latitude);
  const latitudeDelta = rightLatitude - leftLatitude;
  const longitudeDelta = degreesToRadians(
    rightCoordinate.longitude - leftCoordinate.longitude
  );
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude)
      * Math.cos(rightLatitude)
      * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(Math.max(0, 1 - haversine))
  );
};

/**
 * Orders a route by repeatedly choosing the closest remaining representative
 * city point. The supplied first stop is always retained. Equal-distance stops
 * resolve by checked-in catalog order and then by venue ID.
 */
export const orderRouteByProximity = (routeVenueIds: readonly string[]): string[] => {
  const resolvedRoute = assertAndResolveRoute(routeVenueIds);
  if (resolvedRoute.length <= 1) return resolvedRoute.map(({ venue }) => venue.id);

  const orderedVenueIds = [resolvedRoute[0].venue.id];
  const remaining = resolvedRoute.slice(1);
  let currentVenue = resolvedRoute[0];

  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = getVenueDistance(currentVenue.venue, remaining[0].venue);

    for (let index = 1; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateDistance = getVenueDistance(currentVenue.venue, candidate.venue);
      const distanceComparison = candidateDistance - nearestDistance;
      const tieComparison = candidate.catalogIndex - remaining[nearestIndex].catalogIndex
        || compareIds(candidate.venue.id, remaining[nearestIndex].venue.id);

      if (distanceComparison < 0 || (distanceComparison === 0 && tieComparison < 0)) {
        nearestIndex = index;
        nearestDistance = candidateDistance;
      }
    }

    const [nearestVenue] = remaining.splice(nearestIndex, 1);
    orderedVenueIds.push(nearestVenue.venue.id);
    currentVenue = nearestVenue;
  }

  return orderedVenueIds;
};

/**
 * Places modeled route stops first by descending normalized weight. Equal
 * weights, and all unmodeled stops, retain their original route order.
 */
export const orderRouteByPriority = (
  routeVenueIds: readonly string[],
  weightedById: ReadonlyMap<string, WeightedRouteVenue>
): string[] => {
  const resolvedRoute = assertAndResolveRoute(routeVenueIds);

  weightedById.forEach(({ weight }, venueId) => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Route weight for ${venueId} must be finite and non-negative.`);
    }
  });

  return resolvedRoute
    .map(({ venue }, routeIndex) => ({
      modeled: weightedById.has(venue.id),
      routeIndex,
      venueId: venue.id,
      weight: weightedById.get(venue.id)?.weight ?? 0
    }))
    .sort((left, right) => {
      if (left.modeled !== right.modeled) return left.modeled ? -1 : 1;
      if (left.modeled && right.modeled && left.weight !== right.weight) {
        return right.weight - left.weight;
      }
      return left.routeIndex - right.routeIndex;
    })
    .map(({ venueId }) => venueId);
};
