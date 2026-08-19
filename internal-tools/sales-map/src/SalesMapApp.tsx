import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleDollarSign,
  Info,
  ListOrdered,
  MapPinned,
  Navigation,
  PhoneCall,
  Route as RouteIcon,
  Search,
  Scale,
  SlidersHorizontal,
  Target,
  Trash2,
  ZoomIn,
  ZoomOut,
  X
} from 'lucide-react';
import {
  getExpectedNetValuePerFounderHour,
  getNormalizedSalesPlanningWeights
} from './salesPlanningWeights';
import {
  projectTexasCity,
  TEXAS_CITY_COORDINATES,
  TEXAS_MAP_VIEWPORT,
  TEXAS_OUTLINE_PATH,
  type TexasMapPoint,
  type TexasVenueCity
} from './texasMapGeometry';
import { orderRouteByPriority, orderRouteByProximity } from './salesRoutePlanning';
import { texasVenues, type TexasVenue } from './texasVenues';

type VenuePlanningModel = {
  modeledEconomicCac: number;
  expectedNetValue: number;
  founderHours: number;
};

type VenuePlanningModels = Record<string, VenuePlanningModel | undefined>;
type PlanningField = keyof VenuePlanningModel;
type VenueFilter = 'all' | 'modeled' | 'unmodeled' | 'advisory';
type MapViewLevel = 'state' | 'region' | 'city';

type InteractionStatus = Readonly<{
  id: number;
  message: string;
}>;

type TexasMapWindow = Readonly<{
  height: number;
  level: MapViewLevel;
  viewBox: string;
  width: number;
  x: number;
  y: number;
  zoom: number;
}>;

type PlanningFormProps = {
  initial?: VenuePlanningModel;
  onClear?: () => void;
  onSubmit: (values: VenuePlanningModel) => string | null;
  venue: TexasVenue;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

const preciseCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const formatCurrency = (value: number) => currencyFormatter.format(value);
const formatPreciseCurrency = (value: number) => preciseCurrencyFormatter.format(value);
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const unsupportedRangeMessage = 'These values are too large to calculate a reliable normalized score. Reduce the expected net value or increase founder hours.';
const cityCount = Object.keys(TEXAS_CITY_COORDINATES).length;
const MINIMUM_MAP_CANVAS_WIDTH_PX = 660;
const TARGET_MARKER_SEPARATION_PX = 52;
const MAXIMUM_CLUSTER_MEMBER_RADIUS_PX = 44;
const MAP_VIEW_LEVELS: readonly MapViewLevel[] = ['state', 'region', 'city'];
const MAP_VIEW_ZOOM = {
  state: 1,
  region: 2.25,
  city: 6
} as const satisfies Readonly<Record<MapViewLevel, number>>;
const texasVenueById = new Map(texasVenues.map((venue) => [venue.id, venue]));
const emptyRouteWeights = new Map<string, { weight: number }>();

export const getTexasMapWindow = (
  level: MapViewLevel,
  focus?: TexasMapPoint
): TexasMapWindow => {
  const zoom = MAP_VIEW_ZOOM[level];
  const width = TEXAS_MAP_VIEWPORT.width / zoom;
  const height = TEXAS_MAP_VIEWPORT.height / zoom;
  const center = level === 'state' || !focus
    ? { x: TEXAS_MAP_VIEWPORT.width / 2, y: TEXAS_MAP_VIEWPORT.height / 2 }
    : focus;
  const x = Math.min(
    TEXAS_MAP_VIEWPORT.width - width,
    Math.max(0, center.x - width / 2)
  );
  const y = Math.min(
    TEXAS_MAP_VIEWPORT.height - height,
    Math.max(0, center.y - height / 2)
  );

  return {
    height,
    level,
    viewBox: `${x} ${y} ${width} ${height}`,
    width,
    x,
    y,
    zoom
  };
};

const isPointInMapWindow = (point: TexasMapPoint, mapWindow: TexasMapWindow) => (
  point.x >= mapWindow.x
  && point.x <= mapWindow.x + mapWindow.width
  && point.y >= mapWindow.y
  && point.y <= mapWindow.y + mapWindow.height
);

const clipLineToMapWindow = (
  start: TexasMapPoint,
  end: TexasMapPoint,
  mapWindow: TexasMapWindow
): Readonly<{ start: TexasMapPoint; end: TexasMapPoint }> | undefined => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const boundaries = [
    { delta: -deltaX, distance: start.x - mapWindow.x },
    { delta: deltaX, distance: mapWindow.x + mapWindow.width - start.x },
    { delta: -deltaY, distance: start.y - mapWindow.y },
    { delta: deltaY, distance: mapWindow.y + mapWindow.height - start.y }
  ];
  let minimum = 0;
  let maximum = 1;

  for (const boundary of boundaries) {
    if (boundary.delta === 0) {
      if (boundary.distance < 0) return undefined;
      continue;
    }
    const ratio = boundary.distance / boundary.delta;
    if (boundary.delta < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return undefined;
  }

  return {
    start: { x: start.x + minimum * deltaX, y: start.y + minimum * deltaY },
    end: { x: start.x + maximum * deltaX, y: start.y + maximum * deltaY }
  };
};

export const createVisibleRouteSegment = (
  start: TexasMapPoint,
  end: TexasMapPoint,
  mapWindow: TexasMapWindow,
  mapWidth: number,
  attachedPoints: Readonly<{ start: TexasMapPoint; end: TexasMapPoint }> = { start, end }
) => {
  const startVisible = isPointInMapWindow(attachedPoints.start, mapWindow);
  const endVisible = isPointInMapWindow(attachedPoints.end, mapWindow);
  if (!startVisible && !endVisible) return undefined;

  const clipped = clipLineToMapWindow(start, end, mapWindow);
  if (!clipped) return undefined;
  const deltaX = clipped.end.x - clipped.start.x;
  const deltaY = clipped.end.y - clipped.start.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) return undefined;

  const markerInset = Math.min(
    34 * mapWindow.width / Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX),
    distance * .35
  );
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const visibleStart = startVisible
    ? { x: clipped.start.x + unitX * markerInset, y: clipped.start.y + unitY * markerInset }
    : clipped.start;
  const visibleEnd = endVisible
    ? { x: clipped.end.x - unitX * markerInset, y: clipped.end.y - unitY * markerInset }
    : clipped.end;

  const canvasWidth = Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX);
  const canvasHeight = canvasWidth * TEXAS_MAP_VIEWPORT.height / TEXAS_MAP_VIEWPORT.width;
  const arrowPaddingX = 15 * mapWindow.width / canvasWidth;
  const arrowPaddingY = 15 * mapWindow.height / canvasHeight;
  const safeArrowLine = clipLineToMapWindow(visibleStart, visibleEnd, {
    ...mapWindow,
    height: mapWindow.height - arrowPaddingY * 2,
    width: mapWindow.width - arrowPaddingX * 2,
    x: mapWindow.x + arrowPaddingX,
    y: mapWindow.y + arrowPaddingY
  });
  const rawArrow = safeArrowLine ? {
    x: safeArrowLine.start.x + (safeArrowLine.end.x - safeArrowLine.start.x) * .55,
    y: safeArrowLine.start.y + (safeArrowLine.end.y - safeArrowLine.start.y) * .55
  } : {
    x: visibleStart.x + (visibleEnd.x - visibleStart.x) * .55,
    y: visibleStart.y + (visibleEnd.y - visibleStart.y) * .55
  };

  return {
    angle: Math.atan2(visibleEnd.y - visibleStart.y, visibleEnd.x - visibleStart.x)
      * 180 / Math.PI,
    arrow: {
      x: Math.min(
        mapWindow.x + mapWindow.width - arrowPaddingX,
        Math.max(mapWindow.x + arrowPaddingX, rawArrow.x)
      ),
      y: Math.min(
        mapWindow.y + mapWindow.height - arrowPaddingY,
        Math.max(mapWindow.y + arrowPaddingY, rawArrow.y)
      )
    },
    end: visibleEnd,
    start: visibleStart
  };
};

const formatRouteOrders = (orders: readonly number[]) => orders.length <= 3
  ? orders.join(', ')
  : `${orders.slice(0, 2).join(', ')} +${orders.length - 2}`;

const getWeightedVenues = (
  modelsByVenueId: VenuePlanningModels,
  cacContribution: number
) => getNormalizedSalesPlanningWeights(
  texasVenues.flatMap((venue) => {
    const model = modelsByVenueId[venue.id];
    if (!model) return [];

    return [{
      ...venue,
      ...model,
      expectedNetValuePerFounderHour: getExpectedNetValuePerFounderHour(
        model.expectedNetValue,
        model.founderHours
      )
    }];
  }),
  {
    modeledEconomicCac: cacContribution,
    expectedNetValuePerFounderHour: 100 - cacContribution
  }
);

type WeightedVenue = ReturnType<typeof getWeightedVenues>[number];

type MapCluster = {
  allocation: number;
  cities: TexasVenueCity[];
  id: string;
  labelCity: TexasVenueCity;
  markerSize: number;
  modeledCount: number;
  venues: TexasVenue[];
  x: number;
  y: number;
};

type RouteMapStop = Readonly<{
  estimatedHeight: number;
  estimatedWidth: number;
  id: string;
  label: string;
  orders: number[];
  xPercent: number;
  yPercent: number;
}>;

export const createMapClusters = (
  venues: readonly TexasVenue[],
  weightedById: ReadonlyMap<string, { weight: number }>,
  mapWidth: number,
  mapWindow: TexasMapWindow = getTexasMapWindow('state')
): MapCluster[] => {
  if (
    !Number.isFinite(mapWindow.x)
    || !Number.isFinite(mapWindow.y)
    || !Number.isFinite(mapWindow.width)
    || !Number.isFinite(mapWindow.height)
    || mapWindow.width <= 0
    || mapWindow.height <= 0
  ) {
    throw new RangeError('Map window must use finite positive dimensions.');
  }
  const effectiveMapWidth = Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX)
    * TEXAS_MAP_VIEWPORT.width
    / mapWindow.width;
  const venuesByCity = new Map<TexasVenueCity, TexasVenue[]>();
  venues.forEach((venue) => {
    if (!isPointInMapWindow(projectTexasCity(venue.city), mapWindow)) return;
    venuesByCity.set(venue.city, [...(venuesByCity.get(venue.city) ?? []), venue]);
  });

  const provisionalClusters: Array<{
    cities: TexasVenueCity[];
    points: Array<{ x: number; y: number }>;
    venues: TexasVenue[];
  }> = [];

  [...venuesByCity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([city, cityVenues]) => {
      const point = projectTexasCity(city);
      provisionalClusters.push({ cities: [city], points: [point], venues: [...cityVenues] });
    });

  const minimumSeparation = TARGET_MARKER_SEPARATION_PX
    * TEXAS_MAP_VIEWPORT.width
    / effectiveMapWidth;
  const maximumMemberRadius = MAXIMUM_CLUSTER_MEMBER_RADIUS_PX
    * TEXAS_MAP_VIEWPORT.width
    / effectiveMapWidth;
  const getCenter = (cluster: (typeof provisionalClusters)[number]) => cluster.points.reduce(
    (total, candidate) => ({
      x: total.x + candidate.x / cluster.points.length,
      y: total.y + candidate.y / cluster.points.length
    }),
    { x: 0, y: 0 }
  );

  while (provisionalClusters.length > 1) {
    let closestPair: { distance: number; leftIndex: number; rightIndex: number } | undefined;
    for (let leftIndex = 0; leftIndex < provisionalClusters.length - 1; leftIndex += 1) {
      const leftCenter = getCenter(provisionalClusters[leftIndex]);
      for (let rightIndex = leftIndex + 1; rightIndex < provisionalClusters.length; rightIndex += 1) {
        const rightCenter = getCenter(provisionalClusters[rightIndex]);
        const distance = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
        const mergedPoints = [
          ...provisionalClusters[leftIndex].points,
          ...provisionalClusters[rightIndex].points
        ];
        const mergedCenter = mergedPoints.reduce((total, candidate) => ({
          x: total.x + candidate.x / mergedPoints.length,
          y: total.y + candidate.y / mergedPoints.length
        }), { x: 0, y: 0 });
        const keepsGeographicSpan = mergedPoints.every((candidate) => Math.hypot(
          candidate.x - mergedCenter.x,
          candidate.y - mergedCenter.y
        ) <= maximumMemberRadius);
        if (
          distance <= minimumSeparation
          && keepsGeographicSpan
          && (!closestPair || distance < closestPair.distance)
        ) {
          closestPair = { distance, leftIndex, rightIndex };
        }
      }
    }
    if (!closestPair) break;

    const left = provisionalClusters[closestPair.leftIndex];
    const right = provisionalClusters[closestPair.rightIndex];
    left.cities.push(...right.cities);
    left.points.push(...right.points);
    left.venues.push(...right.venues);
    provisionalClusters.splice(closestPair.rightIndex, 1);
  }

  const mapUnitsPerPixel = TEXAS_MAP_VIEWPORT.width / effectiveMapWidth;
  const edgePadding = 4 * mapUnitsPerPixel;
  const clusters = provisionalClusters.map((cluster) => {
    const point = getCenter(cluster);
    const allocation = cluster.venues.reduce(
      (total, venue) => total + (weightedById.get(venue.id)?.weight ?? 0),
      0
    );
    const modeledCount = cluster.venues.reduce(
      (total, venue) => total + (weightedById.has(venue.id) ? 1 : 0),
      0
    );

    const cityVenueCounts = new Map<TexasVenueCity, number>();
    cluster.venues.forEach((venue) => {
      cityVenueCounts.set(venue.city, (cityVenueCounts.get(venue.city) ?? 0) + 1);
    });
    const labelCity = [...cluster.cities].sort((left, right) => (
      (cityVenueCounts.get(right) ?? 0) - (cityVenueCounts.get(left) ?? 0)
      || left.localeCompare(right)
    ))[0] ?? cluster.cities[0];
    const markerSize = 44 + Math.sqrt(allocation) * 8;
    const markerRadiusX = markerSize / 2 * TEXAS_MAP_VIEWPORT.width / effectiveMapWidth;
    const markerRadiusY = markerSize / 2 * TEXAS_MAP_VIEWPORT.height / (effectiveMapWidth * .96);

    return {
      allocation,
      cities: cluster.cities,
      id: cluster.cities.join('--').toLowerCase().replaceAll(' ', '-'),
      labelCity,
      markerSize,
      modeledCount,
      venues: cluster.venues,
      x: Math.min(
        mapWindow.x + mapWindow.width - markerRadiusX - edgePadding,
        Math.max(mapWindow.x + markerRadiusX + edgePadding, point.x)
      ),
      y: Math.min(
        mapWindow.y + mapWindow.height - markerRadiusY - edgePadding,
        Math.max(mapWindow.y + markerRadiusY + edgePadding, point.y)
      )
    };
  });

  const clampClusterToWindow = (cluster: MapCluster) => {
    const markerRadiusX = cluster.markerSize / 2 * mapUnitsPerPixel;
    const markerRadiusY = cluster.markerSize / 2
      * TEXAS_MAP_VIEWPORT.height
      / (effectiveMapWidth * .96);
    cluster.x = Math.min(
      mapWindow.x + mapWindow.width - markerRadiusX - edgePadding,
      Math.max(mapWindow.x + markerRadiusX + edgePadding, cluster.x)
    );
    cluster.y = Math.min(
      mapWindow.y + mapWindow.height - markerRadiusY - edgePadding,
      Math.max(mapWindow.y + markerRadiusY + edgePadding, cluster.y)
    );
  };

  for (let iteration = 0; iteration < 96; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < clusters.length - 1; leftIndex += 1) {
      const left = clusters[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const right = clusters[rightIndex];
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.hypot(deltaX, deltaY);
        const requiredDistance = (
          (left.markerSize + right.markerSize) / 2 + 4
        ) * mapUnitsPerPixel;
        if (distance >= requiredDistance) continue;

        const unitX = distance ? deltaX / distance : 1;
        const unitY = distance ? deltaY / distance : 0;
        const shift = (requiredDistance - distance) / 2;
        left.x -= unitX * shift;
        left.y -= unitY * shift;
        right.x += unitX * shift;
        right.y += unitY * shift;
        clampClusterToWindow(left);
        clampClusterToWindow(right);
        moved = true;
      }
    }
    if (!moved) break;
  }

  clusters.forEach(clampClusterToWindow);

  return clusters;
};

export const createRouteMapStops = (
  routeVenues: readonly TexasVenue[],
  routeStopByVenueId: ReadonlyMap<string, number>,
  mapWidth: number,
  mapWindow: TexasMapWindow
): RouteMapStop[] => {
  const canvasWidth = Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX);
  const canvasHeight = canvasWidth * TEXAS_MAP_VIEWPORT.height / TEXAS_MAP_VIEWPORT.width;
  const clusters = createMapClusters(
    routeVenues,
    emptyRouteWeights,
    mapWidth,
    mapWindow
  ).map((cluster) => {
    const orders = cluster.venues.map((venue) => routeStopByVenueId.get(venue.id) ?? 0)
      .filter((order) => order > 0)
      .sort((left, right) => left - right);
    const label = formatRouteOrders(orders);
    return {
      cluster,
      estimatedHeight: 28,
      estimatedWidth: Math.max(28, 16 + label.length * 6.5),
      label,
      orders
    };
  }).sort((left, right) => left.orders[0] - right.orders[0]);
  const placed: Array<{
    bottom: number;
    left: number;
    right: number;
    top: number;
  }> = [];
  const angleOffsets = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4,
    -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4];
  const radii = [32, 50, 70, 92, 118];

  return clusters.map(({ cluster, estimatedHeight, estimatedWidth, label, orders }) => {
    const markerX = (cluster.x - mapWindow.x) / mapWindow.width * canvasWidth;
    const markerY = (cluster.y - mapWindow.y) / mapWindow.height * canvasHeight;
    const baseAngle = Math.atan2(canvasHeight / 2 - markerY, canvasWidth / 2 - markerX);
    const candidates = radii.flatMap((radius) => angleOffsets.map((offset) => {
      const centerX = Math.min(
        canvasWidth - estimatedWidth / 2 - 4,
        Math.max(estimatedWidth / 2 + 4, markerX + Math.cos(baseAngle + offset) * radius)
      );
      const centerY = Math.min(
        canvasHeight - estimatedHeight / 2 - 4,
        Math.max(estimatedHeight / 2 + 4, markerY + Math.sin(baseAngle + offset) * radius)
      );
      return {
        bottom: centerY + estimatedHeight / 2,
        centerX,
        centerY,
        left: centerX - estimatedWidth / 2,
        right: centerX + estimatedWidth / 2,
        top: centerY - estimatedHeight / 2
      };
    }));
    const candidate = candidates.find((next) => placed.every((prior) => (
      next.right + 4 <= prior.left
      || next.left >= prior.right + 4
      || next.bottom + 4 <= prior.top
      || next.top >= prior.bottom + 4
    ))) ?? candidates[0];
    placed.push(candidate);

    return {
      estimatedHeight,
      estimatedWidth,
      id: cluster.id,
      label,
      orders,
      xPercent: candidate.centerX / canvasWidth * 100,
      yPercent: candidate.centerY / canvasHeight * 100
    };
  });
};

function PlanningForm({ initial, onClear, onSubmit, venue }: PlanningFormProps) {
  const cacInputRef = useRef<HTMLInputElement>(null);
  const [modeledEconomicCac, setModeledEconomicCac] = useState(
    initial ? String(initial.modeledEconomicCac) : ''
  );
  const [expectedNetValue, setExpectedNetValue] = useState(
    initial ? String(initial.expectedNetValue) : ''
  );
  const [founderHours, setFounderHours] = useState(initial ? String(initial.founderHours) : '');
  const [error, setError] = useState<{ field: PlanningField; message: string } | null>(null);
  const idPrefix = `sales-model-${venue.id}`;
  const errorId = `${idPrefix}-error`;

  useEffect(() => {
    setModeledEconomicCac(initial ? String(initial.modeledEconomicCac) : '');
    setExpectedNetValue(initial ? String(initial.expectedNetValue) : '');
    setFounderHours(initial ? String(initial.founderHours) : '');
    setError(null);
  }, [initial, venue.id]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedCac = Number(modeledEconomicCac);
    const parsedNetValue = Number(expectedNetValue);
    const parsedFounderHours = Number(founderHours);

    if (!modeledEconomicCac.trim() || !Number.isFinite(parsedCac) || parsedCac < 0) {
      setError({
        field: 'modeledEconomicCac',
        message: 'Modeled economic CAC must be a non-negative amount.'
      });
      return;
    }
    if (!expectedNetValue.trim() || !Number.isFinite(parsedNetValue)) {
      setError({ field: 'expectedNetValue', message: 'Expected net value must be a valid amount.' });
      return;
    }
    if (!founderHours.trim() || !Number.isFinite(parsedFounderHours) || parsedFounderHours <= 0) {
      setError({ field: 'founderHours', message: 'Founder hours must be greater than zero.' });
      return;
    }

    try {
      getExpectedNetValuePerFounderHour(parsedNetValue, parsedFounderHours);
    } catch (submissionError) {
      if (!(submissionError instanceof RangeError)) throw submissionError;
      setError({ field: 'expectedNetValue', message: unsupportedRangeMessage });
      return;
    }

    const submissionError = onSubmit({
      modeledEconomicCac: parsedCac,
      expectedNetValue: parsedNetValue,
      founderHours: parsedFounderHours
    });
    if (submissionError) {
      setError({ field: 'expectedNetValue', message: submissionError });
      return;
    }
    setError(null);
  };

  return (
    <form
      className="sales-opportunity-form"
      onSubmit={submit}
      aria-label={`Planning inputs for ${venue.name}`}
    >
      <div className="sales-opportunity-form-grid">
        <label htmlFor={`${idPrefix}-cac`}>
          <span>Modeled economic CAC</span>
          <small>Lower is better</small>
          <input
            ref={cacInputRef}
            id={`${idPrefix}-cac`}
            name="modeledEconomicCac"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={modeledEconomicCac}
            onChange={(event) => setModeledEconomicCac(event.target.value)}
            placeholder="0.00"
            aria-invalid={error?.field === 'modeledEconomicCac'}
            aria-describedby={error?.field === 'modeledEconomicCac' ? errorId : undefined}
          />
        </label>
        <label htmlFor={`${idPrefix}-net-value`}>
          <span>Expected net value</span>
          <small>May be negative</small>
          <input
            id={`${idPrefix}-net-value`}
            name="expectedNetValue"
            type="number"
            step="any"
            inputMode="decimal"
            value={expectedNetValue}
            onChange={(event) => setExpectedNetValue(event.target.value)}
            placeholder="0.00"
            aria-invalid={error?.field === 'expectedNetValue'}
            aria-describedby={error?.field === 'expectedNetValue' ? errorId : undefined}
          />
        </label>
        <label htmlFor={`${idPrefix}-founder-hours`}>
          <span>Founder hours required</span>
          <small>Total productive time</small>
          <input
            id={`${idPrefix}-founder-hours`}
            name="founderHours"
            type="number"
            min="0.01"
            step="any"
            inputMode="decimal"
            value={founderHours}
            onChange={(event) => setFounderHours(event.target.value)}
            placeholder="0.00"
            aria-invalid={error?.field === 'founderHours'}
            aria-describedby={error?.field === 'founderHours' ? errorId : undefined}
          />
        </label>
      </div>
      <p className="sales-form-note">
        Expected net value per founder hour is calculated from the last two fields.
      </p>
      {error ? <p id={errorId} className="sales-form-error" role="alert">{error.message}</p> : null}
      <div className="sales-form-actions">
        {onClear ? (
          <button
            type="button"
            key="clear"
            className="ghost-button"
            onClick={() => {
              onClear();
              setModeledEconomicCac('');
              setExpectedNetValue('');
              setFounderHours('');
              setError(null);
              cacInputRef.current?.focus();
            }}
          >
            <X size={15} /> Clear planning inputs
          </button>
        ) : null}
        <button type="submit" key="submit" className="primary-button">
          {initial ? 'Update weighting' : 'Add to weighting'}
        </button>
      </div>
    </form>
  );
}

const filterLabels: Readonly<Record<VenueFilter, string>> = {
  all: 'All',
  modeled: 'Modeled',
  unmodeled: 'Not modeled',
  advisory: 'Has advisory'
};

const handleRovingListKeyDown = (
  event: ReactKeyboardEvent<HTMLButtonElement>,
  venueIds: readonly string[],
  currentIndex: number,
  onSelect: (venueId: string) => void
) => {
  const navigationKeys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
  if (!navigationKeys.includes(event.key)) return;
  event.preventDefault();

  const lastIndex = venueIds.length - 1;
  const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    ? Math.min(currentIndex + 1, lastIndex)
    : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    ? Math.max(currentIndex - 1, 0)
    : event.key === 'Home'
    ? 0
    : event.key === 'End'
    ? lastIndex
    : -1;
  if (nextIndex < 0 || nextIndex === currentIndex) return;

  onSelect(venueIds[nextIndex]);
  const buttons = event.currentTarget.closest('ul, ol')?.querySelectorAll<HTMLButtonElement>('button');
  buttons?.[nextIndex]?.focus();
};

export default function SalesMapApp() {
  const [modelsByVenueId, setModelsByVenueId] = useState<VenuePlanningModels>({});
  const [selectedId, setSelectedId] = useState(texasVenues[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VenueFilter>('all');
  const [cacContribution, setCacContribution] = useState(50);
  const [mapWidth, setMapWidth] = useState(750);
  const [mapViewLevel, setMapViewLevel] = useState<MapViewLevel>('state');
  const [activeClusterId, setActiveClusterId] = useState('');
  const [routeVenueIds, setRouteVenueIds] = useState<string[]>([]);
  const [interactionStatus, setInteractionStatus] = useState<InteractionStatus>({
    id: 0,
    message: ''
  });
  const mapPlotRef = useRef<HTMLDivElement>(null);
  const mapScrollRef = useRef<HTMLDivElement>(null);
  const clusterListRef = useRef<HTMLUListElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const routeHeadingRef = useRef<HTMLHeadingElement>(null);
  const routeItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const moveEarlierRef = useRef<HTMLButtonElement>(null);
  const moveLaterRef = useRef<HTMLButtonElement>(null);
  const showAllButtonRef = useRef<HTMLButtonElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingClusterFocus = useRef(false);
  const pendingMapFocus = useRef(false);
  const pendingFilteredActionFocus = useRef(false);
  const pendingRouteHeadingFocus = useRef(false);
  const pendingRouteItemFocus = useRef('');
  const pendingRouteMoveFocus = useRef<'earlier' | 'later' | null>(null);
  const activeClusterVenueAnchor = useRef('');

  const weightedVenues = useMemo(
    () => getWeightedVenues(modelsByVenueId, cacContribution),
    [cacContribution, modelsByVenueId]
  );
  const weightedById = useMemo(
    () => new Map(weightedVenues.map((venue) => [venue.id, venue])),
    [weightedVenues]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleVenues = useMemo(() => texasVenues.filter((venue) => {
    const model = modelsByVenueId[venue.id];
    const matchesFilter = filter === 'all'
      || (filter === 'modeled' && Boolean(model))
      || (filter === 'unmodeled' && !model)
      || (filter === 'advisory' && Boolean(venue.note));
    const matchesQuery = !normalizedQuery || [venue.name, venue.city, venue.note ?? '']
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    return matchesFilter && matchesQuery;
  }), [filter, modelsByVenueId, normalizedQuery]);

  useEffect(() => {
    if (
      visibleVenues.length
      && !visibleVenues.some((venue) => venue.id === selectedId)
    ) {
      setSelectedId(visibleVenues[0]?.id ?? '');
    }
  }, [selectedId, visibleVenues]);

  useEffect(() => {
    const plot = mapPlotRef.current;
    if (!plot) return;
    const updateWidth = () => {
      if (plot.clientWidth > 0) setMapWidth(plot.clientWidth);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateWidth);
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  const selectedCatalogVenue = texasVenueById.get(selectedId);
  const selectedVenue = visibleVenues.find((venue) => venue.id === selectedId)
    ?? visibleVenues[0];
  const selectedMapPoint = selectedCatalogVenue
    ? projectTexasCity(selectedCatalogVenue.city)
    : undefined;
  const mapWindow = useMemo(
    () => getTexasMapWindow(mapViewLevel, selectedMapPoint),
    [mapViewLevel, selectedMapPoint?.x, selectedMapPoint?.y]
  );
  const mapClusters = useMemo(
    () => createMapClusters(visibleVenues, weightedById, mapWidth, mapWindow),
    [mapWidth, mapWindow, visibleVenues, weightedById]
  );
  const routeVenues = useMemo(() => routeVenueIds.map((venueId) => {
    const venue = texasVenueById.get(venueId);
    if (!venue) throw new RangeError(`Unknown route venue: ${venueId}`);
    return venue;
  }), [routeVenueIds]);
  const routeStopByVenueId = useMemo(
    () => new Map(routeVenueIds.map((venueId, index) => [venueId, index + 1])),
    [routeVenueIds]
  );
  const routeSegments = useMemo(() => {
    const legs = routeVenues.slice(1).flatMap((venue, index) => {
      const previousVenue = routeVenues[index];
      if (previousVenue.city === venue.city) return [];
      const pairKey = [previousVenue.city, venue.city].sort().join('|');
      return [{
        endCity: venue.city,
        endStop: index + 2,
        pairKey,
        startCity: previousVenue.city,
        startStop: index + 1
      }];
    });
    const uniqueLegs = [...legs.reduce((byDirection, leg) => {
      const directionKey = `${leg.startCity}->${leg.endCity}`;
      if (!byDirection.has(directionKey)) byDirection.set(directionKey, leg);
      return byDirection;
    }, new Map<string, (typeof legs)[number]>()).values()];
    const pairCounts = new Map<string, number>();
    uniqueLegs.forEach(({ pairKey }) => (
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1)
    ));
    const pairOccurrences = new Map<string, number>();
    const laneSpacing = 30 * mapWindow.width
      / Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX);

    return uniqueLegs.flatMap((leg) => {
      const occurrence = pairOccurrences.get(leg.pairKey) ?? 0;
      pairOccurrences.set(leg.pairKey, occurrence + 1);
      const pairCount = pairCounts.get(leg.pairKey) ?? 1;
      const laneIndex = occurrence - (pairCount - 1) / 2;
      const [canonicalStartCity, canonicalEndCity] = [leg.startCity, leg.endCity]
        .sort() as [TexasVenueCity, TexasVenueCity];
      const canonicalStart = projectTexasCity(canonicalStartCity);
      const canonicalEnd = projectTexasCity(canonicalEndCity);
      const canonicalDeltaX = canonicalEnd.x - canonicalStart.x;
      const canonicalDeltaY = canonicalEnd.y - canonicalStart.y;
      const canonicalDistance = Math.hypot(canonicalDeltaX, canonicalDeltaY) || 1;
      const offsetX = -canonicalDeltaY / canonicalDistance * laneIndex * laneSpacing;
      const offsetY = canonicalDeltaX / canonicalDistance * laneIndex * laneSpacing;
      const startPoint = projectTexasCity(leg.startCity);
      const endPoint = projectTexasCity(leg.endCity);
      const visibleSegment = createVisibleRouteSegment(
        startPoint,
        endPoint,
        mapWindow,
        mapWidth
      );
      if (!visibleSegment) return [];
      const canvasWidth = Math.max(mapWidth, MINIMUM_MAP_CANVAS_WIDTH_PX);
      const canvasHeight = canvasWidth * TEXAS_MAP_VIEWPORT.height / TEXAS_MAP_VIEWPORT.width;
      const arrowPaddingX = 15 * mapWindow.width / canvasWidth;
      const arrowPaddingY = 15 * mapWindow.height / canvasHeight;
      const arrow = {
        x: Math.min(
          mapWindow.x + mapWindow.width - arrowPaddingX,
          Math.max(mapWindow.x + arrowPaddingX, visibleSegment.arrow.x + offsetX)
        ),
        y: Math.min(
          mapWindow.y + mapWindow.height - arrowPaddingY,
          Math.max(mapWindow.y + arrowPaddingY, visibleSegment.arrow.y + offsetY)
        )
      };
      return [{ ...leg, ...visibleSegment, arrow }];
    });
  }, [mapWidth, mapWindow, routeVenues]);
  const routeMapStops = useMemo(() => createRouteMapStops(
    routeVenues,
    routeStopByVenueId,
    mapWidth,
    mapWindow
  ), [mapWidth, mapWindow, routeStopByVenueId, routeVenues]);
  useEffect(() => {
    const scrollRegion = mapScrollRef.current;
    const selectedCluster = mapClusters.find((cluster) => cluster.venues.some(
      (venue) => venue.id === selectedId
    ));
    if (!scrollRegion || !selectedCluster || scrollRegion.scrollWidth <= scrollRegion.clientWidth) {
      return;
    }

    const markerCenter = (
      selectedCluster.x - mapWindow.x
    ) / mapWindow.width * scrollRegion.scrollWidth;
    scrollRegion.scrollLeft = Math.max(0, Math.min(
      scrollRegion.scrollWidth - scrollRegion.clientWidth,
      markerCenter - scrollRegion.clientWidth / 2
    ));
  }, [mapWidth, mapWindow.width, mapWindow.x, selectedId]);
  useEffect(() => {
    if (activeClusterId && !mapClusters.some((cluster) => cluster.id === activeClusterId)) {
      const activeElement = document.activeElement;
      const shouldRestoreMapFocus = !activeElement
        || activeElement === document.body
        || Boolean(activeElement.closest('.sales-cluster-browser'));
      const replacement = mapClusters.find((cluster) => cluster.venues.some(
        (venue) => venue.id === activeClusterVenueAnchor.current
      ));
      if (replacement) {
        pendingClusterFocus.current = shouldRestoreMapFocus;
        setActiveClusterId(replacement.id);
      } else {
        activeClusterVenueAnchor.current = '';
        pendingMapFocus.current = shouldRestoreMapFocus;
        setActiveClusterId('');
      }
    }
  }, [activeClusterId, mapClusters]);

  useEffect(() => {
    if (!activeClusterId || !pendingClusterFocus.current) return;
    const firstButton = clusterListRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?? clusterListRef.current?.querySelector<HTMLButtonElement>('button');
    if (!firstButton) return;

    pendingClusterFocus.current = false;
    firstButton.focus();
  }, [activeClusterId]);

  useEffect(() => {
    if (activeClusterId || !pendingMapFocus.current) return;
    pendingMapFocus.current = false;
    mapScrollRef.current?.focus();
  }, [activeClusterId]);

  const selectedModel = selectedVenue ? modelsByVenueId[selectedVenue.id] : undefined;
  const selectedWeight = selectedVenue ? weightedById.get(selectedVenue.id) : undefined;
  const rankedVenues = useMemo(() => [...weightedVenues].sort((left, right) => (
    right.weight - left.weight || left.name.localeCompare(right.name)
  )), [weightedVenues]);
  const directoryVenues = useMemo(() => [...visibleVenues].sort((left, right) => (
    left.city.localeCompare(right.city) || left.name.localeCompare(right.name)
  )), [visibleVenues]);
  const activeCluster = mapClusters.find((cluster) => cluster.id === activeClusterId);
  const activeClusterVenues = activeCluster ? [...activeCluster.venues].sort((left, right) => (
    Number(right.city === activeCluster.labelCity) - Number(left.city === activeCluster.labelCity)
    || left.city.localeCompare(right.city)
    || left.name.localeCompare(right.name)
  )) : [];
  const topVenue = rankedVenues[0];
  const selectedRouteIndex = selectedVenue
    ? routeVenueIds.indexOf(selectedVenue.id)
    : -1;
  const mapVenueCount = mapClusters.reduce(
    (total, cluster) => total + cluster.venues.length,
    0
  );
  const mapViewLabel = mapViewLevel === 'state'
    ? 'Texas state'
    : mapViewLevel === 'region'
    ? `Region around ${selectedCatalogVenue?.city ?? 'selected city'}`
    : `${selectedCatalogVenue?.city ?? 'Selected city'} city-area`;

  useEffect(() => {
    if (!pendingFilteredActionFocus.current) return;
    pendingFilteredActionFocus.current = false;
    if (selectedVenue) detailHeadingRef.current?.focus();
    else showAllButtonRef.current?.focus();
  }, [selectedVenue?.id]);

  useEffect(() => {
    if (!pendingRouteHeadingFocus.current) return;
    pendingRouteHeadingFocus.current = false;
    routeHeadingRef.current?.focus();
  }, [routeVenueIds.length]);

  useEffect(() => {
    const venueId = pendingRouteItemFocus.current;
    if (!venueId) return;
    const routeButton = routeItemRefs.current.get(venueId);
    if (!routeButton) return;
    pendingRouteItemFocus.current = '';
    routeButton.focus();
  }, [routeVenueIds, selectedId]);

  useEffect(() => {
    const focusTarget = pendingRouteMoveFocus.current;
    if (!focusTarget) return;
    pendingRouteMoveFocus.current = null;
    (focusTarget === 'earlier' ? moveEarlierRef : moveLaterRef).current?.focus();
  }, [routeVenueIds]);

  const announceInteraction = (message: string) => {
    setInteractionStatus((current) => ({ id: current.id + 1, message }));
  };

  const savePlanningModel = (venueId: string, values: VenuePlanningModel) => {
    const nextModels = { ...modelsByVenueId, [venueId]: values };
    try {
      getWeightedVenues(nextModels, cacContribution);
    } catch (submissionError) {
      if (!(submissionError instanceof RangeError)) throw submissionError;
      return unsupportedRangeMessage;
    }

    if (filter === 'unmodeled') pendingFilteredActionFocus.current = true;
    setModelsByVenueId(nextModels);
    return null;
  };

  const clearPlanningModel = (venueId: string) => {
    const nextModels = { ...modelsByVenueId };
    delete nextModels[venueId];
    if (filter === 'modeled') pendingFilteredActionFocus.current = true;
    setModelsByVenueId(nextModels);
  };

  const revealVenue = (venueId: string) => {
    setQuery('');
    setFilter('all');
    setSelectedId(venueId);
    setActiveClusterId('');
    activeClusterVenueAnchor.current = '';
  };

  const closeActiveCluster = () => {
    if (!activeCluster) return;
    const marker = markerRefs.current.get(activeCluster.id);
    setActiveClusterId('');
    activeClusterVenueAnchor.current = '';
    marker?.focus();
  };

  const changeMapView = (level: MapViewLevel) => {
    setMapViewLevel(level);
    setActiveClusterId('');
    activeClusterVenueAnchor.current = '';
    const viewLabel = level === 'state'
      ? 'Texas state view'
      : level === 'region'
      ? `Regional view around ${selectedCatalogVenue?.city ?? 'the selected city'}`
      : `City-area view around ${selectedCatalogVenue?.city ?? 'the selected city'}`;
    announceInteraction(`${viewLabel}.`);
  };

  const stepMapView = (direction: -1 | 1) => {
    const currentIndex = MAP_VIEW_LEVELS.indexOf(mapViewLevel);
    const nextIndex = Math.min(
      MAP_VIEW_LEVELS.length - 1,
      Math.max(0, currentIndex + direction)
    );
    changeMapView(MAP_VIEW_LEVELS[nextIndex]);
  };

  const addSelectedVenueToRoute = () => {
    if (!selectedVenue) return;
    const nextStop = routeVenueIds.length + 1;
    setRouteVenueIds((current) => current.includes(selectedVenue.id)
      ? current
      : [...current, selectedVenue.id]);
    announceInteraction(`Added ${selectedVenue.name} as cold-call stop ${nextStop}.`);
  };

  const removeRouteVenue = (venueId: string, selectNeighbor: boolean) => {
    const routeIndex = routeVenueIds.indexOf(venueId);
    if (routeIndex < 0) return;
    const venue = texasVenueById.get(venueId);
    const nextRoute = routeVenueIds.filter((candidateId) => candidateId !== venueId);
    if (selectNeighbor) {
      const nextVenueId = nextRoute[Math.min(routeIndex, nextRoute.length - 1)];
      if (nextVenueId) {
        pendingRouteItemFocus.current = nextVenueId;
        revealVenue(nextVenueId);
      }
      else pendingRouteHeadingFocus.current = true;
    }
    setRouteVenueIds(nextRoute);
    announceInteraction(`Removed ${venue?.name ?? 'venue'} from the cold-call route.`);
  };

  const toggleSelectedVenueRoute = () => {
    if (!selectedVenue) return;
    if (routeVenueIds.includes(selectedVenue.id)) {
      removeRouteVenue(selectedVenue.id, false);
    } else {
      addSelectedVenueToRoute();
    }
  };

  const moveSelectedRouteStop = (direction: -1 | 1) => {
    if (!selectedVenue) return;
    const routeIndex = routeVenueIds.indexOf(selectedVenue.id);
    const nextIndex = routeIndex + direction;
    if (routeIndex < 0 || nextIndex < 0 || nextIndex >= routeVenueIds.length) return;
    const nextRoute = [...routeVenueIds];
    [nextRoute[routeIndex], nextRoute[nextIndex]] = [nextRoute[nextIndex], nextRoute[routeIndex]];
    if (nextIndex === 0) pendingRouteMoveFocus.current = 'later';
    else if (nextIndex === routeVenueIds.length - 1) pendingRouteMoveFocus.current = 'earlier';
    setRouteVenueIds(nextRoute);
    announceInteraction(`${selectedVenue.name} moved to cold-call stop ${nextIndex + 1}.`);
  };

  const orderColdCallsByPriority = () => {
    setRouteVenueIds((current) => orderRouteByPriority(current, weightedById));
    announceInteraction('Cold-call route ordered by normalized priority; unmodeled stops remain last.');
  };

  const orderColdCallsByProximity = () => {
    const firstVenue = texasVenueById.get(routeVenueIds[0]);
    setRouteVenueIds((current) => orderRouteByProximity(current));
    announceInteraction(`Cold-call route ordered by geographic proximity from ${firstVenue?.name ?? 'stop 1'}.`);
  };

  const clearColdCallRoute = () => {
    if (!routeVenueIds.length) return;
    pendingRouteHeadingFocus.current = true;
    setRouteVenueIds([]);
    announceInteraction('Cleared the cold-call route.');
  };

  return (
    <main className="app-shell sales-map-page">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={interactionStatus.id}>{interactionStatus.message}</span>
      </p>
      <header className="topbar sales-map-topbar">
        <div>
          <div className="eyebrow">Internal Texas sales planning tool</div>
          <h1>Texas Poker Opportunity Map</h1>
          <p>
            Explore Texas at state, regional, and city-area levels, model opportunities, and build an ordered cold-call sequence.
          </p>
        </div>
        <div className="topbar-actions">
          <span className="sales-local-badge">132 supplied venues · session-only planning inputs</span>
        </div>
      </header>

      <section className="sales-map-summary" aria-label="Texas venue map summary">
        <article>
          <span>Venues</span>
          <strong>{texasVenues.length}</strong>
          <small>from the supplied catalog</small>
        </article>
        <article>
          <span>Texas cities</span>
          <strong>{cityCount}</strong>
          <small>representative city points</small>
        </article>
        <article>
          <span>Modeled venues</span>
          <strong>{weightedVenues.length}</strong>
          <small>included in normalization</small>
        </article>
        <article>
          <span>Highest allocation</span>
          <strong>{topVenue ? formatPercent(topVenue.weight) : '—'}</strong>
          <small>{topVenue?.name ?? 'Add planning inputs'}</small>
        </article>
      </section>

      <section className="sales-map-toolbar panel" aria-label="Map search and filters">
        <label className="sales-search-control" htmlFor="sales-venue-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search venues, cities, or advisories</span>
          <input
            id="sales-venue-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search venue, city, or advisory"
            aria-describedby="sales-search-help"
          />
        </label>
        <div className="sales-filter-group" role="group" aria-label="Filter venues">
          <SlidersHorizontal size={16} aria-hidden="true" />
          {(Object.keys(filterLabels) as VenueFilter[]).map((option) => (
            <button
              type="button"
              key={option}
              className={filter === option ? 'active' : ''}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {filterLabels[option]}
            </button>
          ))}
        </div>
        <p id="sales-search-help" className="sales-toolbar-note">
          <span aria-live="polite">Showing {visibleVenues.length} of {texasVenues.length} venues.</span>
          {' '}Filtering changes visibility, not normalized weights.
        </p>
      </section>

      <section className="sales-map-workspace">
        <section className={`panel sales-map-panel${activeCluster ? ' cluster-open' : ''}`}>
          <div className="sales-map-panel-header">
            <div>
              <span className="sales-section-kicker"><MapPinned size={15} /> Texas coverage</span>
              <h2>Supplied venues by listed city</h2>
              <p>Markers combine nearby representative city points. Their locations are approximate, not street addresses.</p>
            </div>
            <label className="sales-balance-control" htmlFor="sales-weight-balance">
              <span><Scale size={15} /> Metric emphasis</span>
              <input
                id="sales-weight-balance"
                type="range"
                min="0"
                max="100"
                step="5"
                value={cacContribution}
                disabled={!weightedVenues.length}
                onChange={(event) => setCacContribution(Number(event.target.value))}
                aria-valuetext={`${cacContribution}% modeled economic CAC and ${100 - cacContribution}% expected net value per founder hour`}
              />
              <small>
                <span>{cacContribution}% CAC</span>
                <span>{100 - cacContribution}% net value / hour</span>
              </small>
            </label>
          </div>

          <div className="sales-map-view-toolbar">
            <div className="sales-map-view-presets" role="group" aria-label="Map view level">
              {MAP_VIEW_LEVELS.map((level) => (
                <button
                  type="button"
                  key={level}
                  className={mapViewLevel === level ? 'active' : ''}
                  aria-pressed={mapViewLevel === level}
                  disabled={level !== 'state' && !selectedCatalogVenue}
                  onClick={() => changeMapView(level)}
                >
                  {level === 'state' ? 'Texas' : level === 'region' ? 'Region' : 'City'}
                </button>
              ))}
            </div>
            <div className="sales-map-zoom-buttons" role="group" aria-label="Step map zoom">
              <button
                type="button"
                aria-label="Zoom out one view level"
                disabled={mapViewLevel === 'state'}
                onClick={() => stepMapView(-1)}
              >
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Zoom in one view level"
                disabled={mapViewLevel === 'city' || !selectedCatalogVenue}
                onClick={() => stepMapView(1)}
              >
                <ZoomIn size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="sales-map-view-status">
              {mapViewLabel} view · {mapWindow.zoom}× · {mapVenueCount} visible {mapVenueCount === 1 ? 'venue' : 'venues'}
            </div>
          </div>

          <figure
            className="sales-texas-map"
            aria-labelledby="sales-map-title"
            aria-describedby="sales-map-description"
          >
            <figcaption id="sales-map-title">Texas venue map</figcaption>
            <p id="sales-map-description" className="sales-map-location-note">
              <Info size={15} aria-hidden="true" /> Locations use representative city points. Region and city-area views are map windows, not official boundaries. The red sequence uses straight connectors, not roads or driving directions; closer views show legs attached to at least one visible stop.
            </p>
            <div
              ref={mapScrollRef}
              className="sales-texas-map-scroll"
              role="region"
              aria-label="Scrollable and zoomable Texas venue map"
              tabIndex={0}
            >
            <div ref={mapPlotRef} className="sales-texas-map-plot">
              <svg
                className="sales-texas-outline"
                viewBox={mapWindow.viewBox}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <path className="sales-texas-state-shape" d={TEXAS_OUTLINE_PATH} />
                {mapViewLevel === 'state' ? <text x="530" y="470">TEXAS</text> : null}
                <g className="sales-route-lines">
                  {routeSegments.map((segment) => (
                    <g key={`${segment.startStop}-${segment.endStop}`}>
                      <line
                        className="sales-route-line-halo"
                        x1={segment.start.x}
                        y1={segment.start.y}
                        x2={segment.end.x}
                        y2={segment.end.y}
                      />
                      <line
                        className="sales-route-line"
                        x1={segment.start.x}
                        y1={segment.start.y}
                        x2={segment.end.x}
                        y2={segment.end.y}
                        data-start-stop={segment.startStop}
                        data-end-stop={segment.endStop}
                      />
                    </g>
                  ))}
                </g>
              </svg>

              {routeSegments.map((segment) => {
                const routeDirectionStyle = {
                  '--sales-route-direction-angle': `${segment.angle}deg`,
                  '--sales-route-direction-x': `${(segment.arrow.x - mapWindow.x) / mapWindow.width * 100}%`,
                  '--sales-route-direction-y': `${(segment.arrow.y - mapWindow.y) / mapWindow.height * 100}%`
                } as CSSProperties;
                return (
                  <span
                    key={`${segment.startStop}-${segment.endStop}`}
                    className="sales-route-direction"
                    style={routeDirectionStyle}
                    aria-hidden="true"
                  />
                );
              })}

              {mapClusters.map((cluster) => {
                const markerStyle = {
                  '--sales-marker-x': `${(cluster.x - mapWindow.x) / mapWindow.width * 100}%`,
                  '--sales-marker-y': `${(cluster.y - mapWindow.y) / mapWindow.height * 100}%`,
                  '--sales-marker-size': `${cluster.markerSize}px`
                } as CSSProperties;
                const selectedIndex = cluster.venues.findIndex((venue) => venue.id === selectedId);
                const isSelected = selectedIndex >= 0;
                const isExpanded = activeClusterId === cluster.id;
                const cityLabel = cluster.cities.length === 1
                  ? cluster.labelCity
                  : `${cluster.labelCity} +${cluster.cities.length - 1}`;
                const allocationLabel = cluster.modeledCount
                  ? ` Combined normalized allocation ${formatPercent(cluster.allocation)}.`
                  : ' No venues in this marker are modeled yet.';
                const selectedLabel = isSelected && selectedVenue
                  ? ` Contains the selected venue, ${selectedVenue.name}.`
                  : '';
                const routeOrders = cluster.venues.flatMap((venue) => {
                  const order = routeStopByVenueId.get(venue.id);
                  return order ? [order] : [];
                }).sort((left, right) => left - right);
                const routeLabel = routeOrders.length
                  ? ` Contains cold-call ${routeOrders.length === 1 ? 'stop' : 'stops'} ${routeOrders.join(', ')}.`
                  : '';
                const clusterLocationLabel = cluster.cities.length === 1
                  ? cluster.labelCity
                  : `${cluster.cities.length}-city cluster anchored near ${cluster.labelCity}`;
                const markerLabel = `${clusterLocationLabel}: ${cluster.cities.join(', ')}. ${cluster.venues.length} ${cluster.venues.length === 1 ? 'venue' : 'venues'}, ${cluster.modeledCount} modeled.${allocationLabel}${routeLabel}${selectedLabel} Activate to open the venue list. Locations are city-level approximations.`;

                return (
                  <button
                    type="button"
                    key={cluster.id}
                    ref={(element) => {
                      if (element) markerRefs.current.set(cluster.id, element);
                      else markerRefs.current.delete(cluster.id);
                    }}
                    className={`sales-map-marker${cluster.modeledCount ? ' modeled' : ''}${isSelected ? ' selected' : ''}`}
                    style={markerStyle}
                    aria-label={markerLabel}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? `sales-cluster-${cluster.id}` : undefined}
                    onClick={() => {
                      if (isExpanded) {
                        const currentButton = clusterListRef.current
                          ?.querySelector<HTMLButtonElement>('button[tabindex="0"]');
                        currentButton?.focus();
                      } else {
                        pendingClusterFocus.current = true;
                      }
                      activeClusterVenueAnchor.current = isSelected
                        ? selectedId
                        : cluster.venues[0]?.id ?? '';
                      setActiveClusterId(cluster.id);
                    }}
                  >
                    <span className="sales-marker-count">{cluster.venues.length}</span>
                    <span className="sales-marker-city">{cityLabel}</span>
                  </button>
                );
              })}

              {routeMapStops.map((group) => {
                const routeStopStyle = {
                  '--sales-route-stop-x': `${group.xPercent}%`,
                  '--sales-route-stop-y': `${group.yPercent}%`
                } as CSSProperties;
                return (
                  <span
                    key={group.id}
                    className="sales-route-map-stop"
                    style={routeStopStyle}
                    aria-hidden="true"
                  >
                    {group.label}
                  </span>
                );
              })}

              {!mapClusters.length ? (
                <div className="sales-map-no-results">
                  <Search size={24} />
                  <strong>No catalog markers match this view</strong>
                  <span>
                    Clear the search or choose another filter.
                    {routeVenueIds.length ? ' Your saved call route remains visible.' : ''}
                  </span>
                </div>
              ) : null}
            </div>
            </div>

            {activeCluster ? (
              <section
                id={`sales-cluster-${activeCluster.id}`}
                className="sales-cluster-browser"
                aria-labelledby="sales-cluster-title"
              >
                <div className="sales-cluster-browser-header">
                  <div>
                    <span className="sales-section-kicker">Selected map marker</span>
                    <h3 id="sales-cluster-title">
                      {activeCluster.cities.length > 1
                        ? `${activeCluster.cities.length}-city cluster · ${activeCluster.labelCity} anchor`
                        : activeCluster.labelCity} · {activeCluster.venues.length} venues
                    </h3>
                    <p>{activeCluster.cities.join(', ')}</p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    aria-label="Close selected marker venue list"
                    onClick={closeActiveCluster}
                  >
                    <X size={15} /> Close
                  </button>
                </div>
                <p id="sales-cluster-keyboard-help" className="sales-list-keyboard-hint">
                  Use arrow keys to move through this venue list. Press Escape to return to the map marker.
                </p>
                <ul
                  ref={clusterListRef}
                  className="sales-cluster-venue-list"
                  aria-label="Venues in selected map marker"
                  aria-describedby="sales-cluster-keyboard-help"
                >
                  {activeClusterVenues.map((venue, index) => {
                    const weightedVenue = weightedById.get(venue.id);
                    const routeStop = routeStopByVenueId.get(venue.id);
                    const isCurrent = selectedVenue?.id === venue.id;
                    return (
                      <li key={venue.id}>
                        <button
                          type="button"
                          className={isCurrent ? 'active' : ''}
                          aria-current={isCurrent ? 'true' : undefined}
                          aria-controls="sales-venue-detail"
                          tabIndex={isCurrent || (
                            !activeClusterVenues.some(({ id }) => id === selectedVenue?.id)
                            && index === 0
                          ) ? 0 : -1}
                          onClick={() => {
                            activeClusterVenueAnchor.current = venue.id;
                            setSelectedId(venue.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              closeActiveCluster();
                              return;
                            }
                            handleRovingListKeyDown(
                              event,
                              activeClusterVenues.map(({ id }) => id),
                              index,
                              (venueId) => {
                                activeClusterVenueAnchor.current = venueId;
                                setSelectedId(venueId);
                              }
                            );
                          }}
                        >
                          <span><strong>{venue.name}</strong><small>{venue.city}{venue.note ? ` · ${venue.note}` : ''}</small></span>
                          <em>{routeStop ? `Stop ${routeStop}` : weightedVenue ? formatPercent(weightedVenue.weight) : 'Not modeled'}</em>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </figure>

          <footer className="sales-map-legend">
            <span><i className="sales-legend-unmodeled" /> Neutral marker = not modeled</span>
            <span><i className="sales-legend-modeled" /> Teal marker = at least one modeled venue</span>
            <span>Number = visible venues in the marker</span>
            <span>Modeled marker size grows with combined allocation</span>
            <span><i className="sales-legend-route" /> Red arrows = cold-call sequence</span>
            <span>Red numbers = call-stop positions; +N = additional stops</span>
            <span>City label appears on hover, focus, selection, or expansion</span>
          </footer>
        </section>

        <aside className="sales-map-sidebar" aria-label="Venue details and normalized ranking">
          <p className="sr-only" aria-live="polite">
            {selectedVenue ? `Selected venue: ${selectedVenue.name}, ${selectedVenue.city}.` : 'No venue is selected.'}
          </p>
          {selectedVenue ? (
            <section id="sales-venue-detail" className="panel sales-opportunity-detail">
              <div className="sales-sidebar-heading">
                <span className="sales-section-kicker"><MapPinned size={15} /> {selectedVenue.city}, Texas</span>
                <h2 ref={detailHeadingRef} tabIndex={-1}>{selectedVenue.name}</h2>
                <p className="sales-city-accuracy">Mapped to the listed city representative point, not an exact venue address.</p>
              </div>

              <div className="sales-route-toggle-row">
                <button
                  type="button"
                  className={selectedRouteIndex >= 0 ? 'secondary-button active' : 'secondary-button'}
                  aria-pressed={selectedRouteIndex >= 0}
                  onClick={toggleSelectedVenueRoute}
                >
                  <PhoneCall size={16} aria-hidden="true" />
                  {selectedRouteIndex >= 0 ? 'Remove from call route' : 'Add to call route'}
                </button>
                <span>{selectedRouteIndex >= 0 ? `Cold-call stop ${selectedRouteIndex + 1}` : 'Not in the route'}</span>
              </div>

              {selectedVenue.note ? (
                <div className="sales-advisory"><Info size={16} /><span>{selectedVenue.note}</span></div>
              ) : (
                <div className="sales-advisory neutral"><Info size={16} /><span>No advisory was supplied.</span></div>
              )}

              {selectedWeight ? (
                <dl className="sales-weight-breakdown">
                  <div>
                    <dt>Modeled economic CAC</dt>
                    <dd>{formatPreciseCurrency(selectedWeight.modeledEconomicCac)}</dd>
                    <small>{formatPercent(selectedWeight.normalizedModeledEconomicCacScore)} relative efficiency</small>
                  </div>
                  <div>
                    <dt>Expected net value / founder hour</dt>
                    <dd>{formatPreciseCurrency(selectedWeight.expectedNetValuePerFounderHour)}</dd>
                    <small>{formatPercent(selectedWeight.normalizedExpectedNetValuePerFounderHourScore)} relative value</small>
                  </div>
                  <div>
                    <dt>Normalized allocation</dt>
                    <dd>{formatPercent(selectedWeight.weight)}</dd>
                    <small>across modeled venues only</small>
                  </div>
                </dl>
              ) : (
                <div className="sales-unmodeled-state">
                  <Target size={18} />
                  <div><strong>Not modeled</strong><span>Add planning inputs to include this venue in normalization.</span></div>
                </div>
              )}

              <div className="sales-editor-divider"><span>Planning inputs</span></div>
              <PlanningForm
                key={selectedVenue.id}
                venue={selectedVenue}
                initial={selectedModel}
                onSubmit={(values) => savePlanningModel(selectedVenue.id, values)}
                onClear={selectedModel ? () => clearPlanningModel(selectedVenue.id) : undefined}
              />
            </section>
          ) : (
            <section id="sales-venue-detail" className="panel sales-no-selection">
              <Search size={24} />
              <h2>No venue matches this view</h2>
              <p>Clear the search and filters to select and model a supplied venue.</p>
              <button
                ref={showAllButtonRef}
                type="button"
                className="secondary-button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Show all venues
              </button>
            </section>
          )}

          <section className="panel sales-route-panel" aria-labelledby="sales-route-heading">
            <div className="sales-sidebar-heading">
              <span className="sales-section-kicker"><RouteIcon size={15} /> Call sequence</span>
              <h2 id="sales-route-heading" ref={routeHeadingRef} tabIndex={-1}>
                Cold-call route · {routeVenueIds.length} {routeVenueIds.length === 1 ? 'stop' : 'stops'}
              </h2>
              <p id="sales-route-help">
                Session-only order. Red connectors link representative city points; they are not roads or driving directions.
              </p>
            </div>

            <div className="sales-route-order-actions" role="group" aria-label="Route ordering controls">
              <button
                type="button"
                className="secondary-button"
                disabled={routeVenueIds.length < 2}
                onClick={orderColdCallsByPriority}
                aria-label="Order cold-call route by normalized priority"
                title="Modeled venues first by normalized allocation; unmodeled stops remain last"
              >
                <ListOrdered size={15} aria-hidden="true" /> Priority
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={routeVenueIds.length < 2}
                onClick={orderColdCallsByProximity}
                aria-label={`Order cold-call route by proximity while retaining stop 1${routeVenues[0] ? `, ${routeVenues[0].name}` : ''}`}
                title="Keep stop 1, then choose the nearest remaining representative city point"
              >
                <Navigation size={15} aria-hidden="true" /> Proximity
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={!routeVenueIds.length}
                onClick={clearColdCallRoute}
                aria-label="Clear the complete cold-call route"
              >
                <Trash2 size={15} aria-hidden="true" /> Clear
              </button>
            </div>

            <ol className="sales-route-list" aria-describedby="sales-route-help">
              {routeVenues.map((venue, index) => {
                const isCurrent = selectedVenue?.id === venue.id;
                const weightedVenue = weightedById.get(venue.id);
                return (
                  <li key={venue.id}>
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) routeItemRefs.current.set(venue.id, element);
                        else routeItemRefs.current.delete(venue.id);
                      }}
                      className={isCurrent ? 'active' : ''}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-controls="sales-venue-detail"
                      tabIndex={isCurrent || (
                        !routeVenueIds.includes(selectedVenue?.id ?? '')
                        && index === 0
                      ) ? 0 : -1}
                      onClick={() => revealVenue(venue.id)}
                      onKeyDown={(event) => handleRovingListKeyDown(
                        event,
                        routeVenueIds,
                        index,
                        revealVenue
                      )}
                    >
                      <span className="sales-route-stop-number" aria-hidden="true">{index + 1}</span>
                      <span className="sales-route-stop-copy">
                        <strong>{venue.name}</strong>
                        <small>{venue.city} · Stop {index + 1} of {routeVenueIds.length}</small>
                      </span>
                      <em>{weightedVenue ? formatPercent(weightedVenue.weight) : 'Unmodeled'}</em>
                    </button>
                  </li>
                );
              })}
              {!routeVenueIds.length ? (
                <li className="sales-ranking-empty">Select a venue and choose “Add to call route” to draw the red sequence.</li>
              ) : null}
            </ol>

            <div className="sales-route-edit-actions" role="group" aria-label="Edit selected route stop">
              <button
                ref={moveEarlierRef}
                type="button"
                className="ghost-button"
                disabled={selectedRouteIndex <= 0}
                onClick={() => moveSelectedRouteStop(-1)}
                aria-label={selectedVenue && selectedRouteIndex >= 0
                  ? `Move ${selectedVenue.name} earlier from stop ${selectedRouteIndex + 1}`
                  : 'Move selected venue earlier'}
              >
                <ArrowUp size={15} aria-hidden="true" /> Earlier
              </button>
              <button
                ref={moveLaterRef}
                type="button"
                className="ghost-button"
                disabled={selectedRouteIndex < 0 || selectedRouteIndex >= routeVenueIds.length - 1}
                onClick={() => moveSelectedRouteStop(1)}
                aria-label={selectedVenue && selectedRouteIndex >= 0
                  ? `Move ${selectedVenue.name} later from stop ${selectedRouteIndex + 1}`
                  : 'Move selected venue later'}
              >
                <ArrowDown size={15} aria-hidden="true" /> Later
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={selectedRouteIndex < 0}
                aria-label={selectedVenue && selectedRouteIndex >= 0
                  ? `Remove ${selectedVenue.name} from cold-call stop ${selectedRouteIndex + 1}`
                  : 'Remove selected venue from the cold-call route'}
                onClick={() => {
                  if (selectedVenue) removeRouteVenue(selectedVenue.id, true);
                }}
              >
                <X size={15} aria-hidden="true" /> Remove stop
              </button>
            </div>
          </section>

          <section className="panel sales-ranking-panel">
            <div className="sales-sidebar-heading">
              <span className="sales-section-kicker"><Scale size={15} /> Normalized ranking</span>
              <h2>Modeled allocation</h2>
              <p id="sales-ranking-keyboard-help">Weights are normalized across modeled venues only. Use arrow keys to move through this list.</p>
            </div>
            <ol className="sales-ranking-list" aria-describedby="sales-ranking-keyboard-help">
              {rankedVenues.map((venue, index) => (
                <li key={venue.id}>
                  <button
                    type="button"
                    className={selectedVenue?.id === venue.id ? 'active' : ''}
                    aria-current={selectedVenue?.id === venue.id ? 'true' : undefined}
                    aria-controls="sales-venue-detail"
                    tabIndex={
                      selectedVenue?.id === venue.id
                      || (!rankedVenues.some(({ id }) => id === selectedVenue?.id) && index === 0)
                        ? 0
                        : -1
                    }
                    onClick={() => revealVenue(venue.id)}
                    onKeyDown={(event) => handleRovingListKeyDown(
                      event,
                      rankedVenues.map(({ id }) => id),
                      index,
                      revealVenue
                    )}
                  >
                    <span className="sales-rank-number">{index + 1}</span>
                    <span className="sales-rank-copy">
                      <strong>{venue.name}</strong>
                      <small>{venue.city} · {formatCurrency(venue.modeledEconomicCac)} CAC · {formatCurrency(venue.expectedNetValuePerFounderHour)}/hr</small>
                    </span>
                    <em>{formatPercent(venue.weight)}</em>
                  </button>
                </li>
              ))}
              {!rankedVenues.length ? (
                <li className="sales-ranking-empty">Add planning inputs to any venue to begin the weighted comparison.</li>
              ) : null}
            </ol>
          </section>

          <section className="panel sales-directory-panel">
            <div className="sales-sidebar-heading">
              <span className="sales-section-kicker"><CircleDollarSign size={15} /> Venue directory</span>
              <h2>{visibleVenues.length} matching venues</h2>
              <p id="sales-directory-keyboard-help">Keyboard-accessible alternative to the geographic markers. Use arrow keys to move through this list.</p>
            </div>
            <ul className="sales-directory-list" aria-describedby="sales-directory-keyboard-help">
              {directoryVenues.map((venue, index) => {
                  const weightedVenue = weightedById.get(venue.id);
                  const routeStop = routeStopByVenueId.get(venue.id);
                  const isCurrent = selectedVenue?.id === venue.id;
                  return (
                    <li key={venue.id}>
                      <button
                        type="button"
                        className={isCurrent ? 'active' : ''}
                        aria-current={isCurrent ? 'true' : undefined}
                        aria-controls="sales-venue-detail"
                        tabIndex={isCurrent || (!selectedVenue && index === 0) ? 0 : -1}
                        onClick={() => {
                          setSelectedId(venue.id);
                          setActiveClusterId('');
                        }}
                        onKeyDown={(event) => handleRovingListKeyDown(
                          event,
                          directoryVenues.map(({ id }) => id),
                          index,
                          (venueId) => {
                            setSelectedId(venueId);
                            setActiveClusterId('');
                          }
                        )}
                      >
                        <span>
                          <strong>{venue.name}</strong>
                          <small>{venue.city}{venue.note ? ` · ${venue.note}` : ''}</small>
                        </span>
                        <em>{routeStop ? `Stop ${routeStop}` : weightedVenue ? formatPercent(weightedVenue.weight) : 'Not modeled'}</em>
                      </button>
                    </li>
                  );
                })}
              {!visibleVenues.length ? (
                <li className="sales-ranking-empty">No venue names, cities, or advisories match this view.</li>
              ) : null}
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}
