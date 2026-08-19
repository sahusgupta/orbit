/**
 * Static geography for the standalone Texas sales map.
 *
 * The outline is a Ramer-Douglas-Peucker simplification (0.04 degree tolerance)
 * of the U.S. Census Bureau's public 2025 1:5,000,000 Cartographic Boundary
 * File for states (KML distribution):
 * https://www2.census.gov/geo/tiger/GENZ2025/kml/cb_2025_us_state_5m.zip
 *
 * City representative points are from the Census Bureau's public 2025 Texas
 * Places Gazetteer unless noted otherwise:
 * https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_48.txt
 *
 * Cypress is not a 2025 Census place. Its Harris County populated-place point
 * is from the U.S. Geological Survey GNIS public service (feature 1355512):
 * https://nimbus.cr.usgs.gov/arcgis/rest/services/GNIS/EDC_GNIS/MapServer/0
 *
 * All values are embedded deliberately: importing this module performs no
 * network request and does not depend on a third-party map service.
 */

export type TexasGeographicCoordinate = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type TexasMapPoint = Readonly<{
  x: number;
  y: number;
}>;

export type TexasMapViewport = Readonly<{
  height: number;
  padding: number;
  width: number;
}>;

export const TEXAS_GEOGRAPHIC_BOUNDS = {
  west: -106.645479,
  east: -93.516407,
  south: 25.837377,
  north: 36.500704
} as const;

export const TEXAS_MAP_VIEWPORT = {
  width: 1_000,
  height: 960,
  padding: 32
} as const satisfies TexasMapViewport;

export const TEXAS_MAP_VIEW_BOX = `0 0 ${TEXAS_MAP_VIEWPORT.width} ${TEXAS_MAP_VIEWPORT.height}`;

export const TEXAS_CITY_COORDINATES = {
  Aledo: { latitude: 32.698282, longitude: -97.608341 },
  Alpine: { latitude: 30.363905, longitude: -103.664456 },
  Amarillo: { latitude: 35.199903, longitude: -101.830194 },
  Austin: { latitude: 30.298622, longitude: -97.754134 },
  Bacliff: { latitude: 29.508637, longitude: -94.988677 },
  Baytown: { latitude: 29.76478, longitude: -94.967457 },
  Beaumont: { latitude: 30.084912, longitude: -94.14533 },
  Beeville: { latitude: 28.405244, longitude: -97.748931 },
  Belton: { latitude: 31.052345, longitude: -97.479542 },
  Brownsville: { latitude: 25.989404, longitude: -97.480625 },
  Brownwood: { latitude: 31.712856, longitude: -98.977053 },
  Bryan: { latitude: 30.666016, longitude: -96.381049 },
  Burleson: { latitude: 32.514445, longitude: -97.323293 },
  'Caddo Mills': { latitude: 33.074543, longitude: -96.226924 },
  Canton: { latitude: 32.554245, longitude: -95.863534 },
  Carrollton: { latitude: 32.989386, longitude: -96.89994 },
  'Cedar Park': { latitude: 30.510177, longitude: -97.818626 },
  'College Station': { latitude: 30.58516, longitude: -96.29636 },
  'Corpus Christi': { latitude: 27.754252, longitude: -97.173385 },
  Cypress: { latitude: 29.969112, longitude: -95.697169 },
  Dallas: { latitude: 32.793333, longitude: -96.766513 },
  'Eagle Pass': { latitude: 28.701071, longitude: -100.476229 },
  Edinburg: { latitude: 26.318374, longitude: -98.15348 },
  'El Paso': { latitude: 31.84778, longitude: -106.431106 },
  Farwell: { latitude: 34.385631, longitude: -103.03734 },
  'Fort Worth': { latitude: 32.781954, longitude: -97.348573 },
  Garland: { latitude: 32.909826, longitude: -96.630334 },
  Georgetown: { latitude: 30.668136, longitude: -97.698744 },
  Gordon: { latitude: 32.545546, longitude: -98.367183 },
  'Grand Prairie': { latitude: 32.67893, longitude: -97.020743 },
  Houston: { latitude: 29.785743, longitude: -95.388806 },
  Humble: { latitude: 29.988207, longitude: -95.264356 },
  Huntsville: { latitude: 30.700542, longitude: -95.55489 },
  Irving: { latitude: 32.857748, longitude: -96.970022 },
  Katy: { latitude: 29.790915, longitude: -95.840711 },
  Killeen: { latitude: 31.077669, longitude: -97.731952 },
  Laredo: { latitude: 27.560379, longitude: -99.489181 },
  Lubbock: { latitude: 33.561901, longitude: -101.888883 },
  Lufkin: { latitude: 31.322904, longitude: -94.729026 },
  'Marble Falls': { latitude: 30.560168, longitude: -98.277286 },
  McAllen: { latitude: 26.224966, longitude: -98.246083 },
  Midland: { latitude: 32.024642, longitude: -102.113467 },
  'Mineral Wells': { latitude: 32.823483, longitude: -98.078798 },
  Mission: { latitude: 26.20406, longitude: -98.325221 },
  Navasota: { latitude: 30.386923, longitude: -96.089807 },
  'New Braunfels': { latitude: 29.699306, longitude: -98.115127 },
  Odessa: { latitude: 31.880461, longitude: -102.345314 },
  Pharr: { latitude: 26.163436, longitude: -98.19389 },
  'Port Lavaca': { latitude: 28.617967, longitude: -96.628288 },
  Richmond: { latitude: 29.581161, longitude: -95.760484 },
  'Round Rock': { latitude: 30.526146, longitude: -97.663532 },
  'San Angelo': { latitude: 31.441078, longitude: -100.450499 },
  'San Antonio': { latitude: 29.462809, longitude: -98.524635 },
  'San Marcos': { latitude: 29.87361, longitude: -97.936725 },
  Sherman: { latitude: 33.628596, longitude: -96.626722 },
  Spring: { latitude: 30.062169, longitude: -95.383966 },
  Stephenville: { latitude: 32.214544, longitude: -98.219885 },
  Texarkana: { latitude: 33.449204, longitude: -94.085008 },
  Victoria: { latitude: 28.828528, longitude: -96.986015 },
  Waco: { latitude: 31.557994, longitude: -97.18975 },
  Webster: { latitude: 29.532072, longitude: -95.116478 },
  'Wichita Falls': { latitude: 33.906654, longitude: -98.525848 },
  Wilmer: { latitude: 32.597428, longitude: -96.680905 }
} as const satisfies Readonly<Record<string, TexasGeographicCoordinate>>;

export type TexasVenueCity = keyof typeof TEXAS_CITY_COORDINATES;

type LongitudeLatitude = readonly [longitude: number, latitude: number];

/** Geographic points run from El Paso down the Rio Grande and close through New Mexico. */
export const TEXAS_OUTLINE_COORDINATES: readonly LongitudeLatitude[] = [
  [-106.645479, 31.89867],
  [-106.489542, 31.748408],
  [-106.381039, 31.73211],
  [-106.205827, 31.465976],
  [-105.953943, 31.364749],
  [-105.394242, 30.852979],
  [-104.924796, 30.604832],
  [-104.859521, 30.390413],
  [-104.687296, 30.179464],
  [-104.679772, 29.924659],
  [-104.507568, 29.639624],
  [-104.038282, 29.320156],
  [-103.791157, 29.263278],
  [-103.27796, 28.979176],
  [-103.115328, 28.98527],
  [-102.994653, 29.17962],
  [-102.866846, 29.225015],
  [-102.883722, 29.348059],
  [-102.670971, 29.741954],
  [-102.386678, 29.76688],
  [-102.315389, 29.87992],
  [-102.115682, 29.79239],
  [-101.415402, 29.756561],
  [-101.305533, 29.577925],
  [-101.252274, 29.625634],
  [-101.254895, 29.520342],
  [-101.060151, 29.458661],
  [-100.797671, 29.246943],
  [-100.674656, 29.099777],
  [-100.500354, 28.66196],
  [-100.333814, 28.499252],
  [-100.293468, 28.278475],
  [-99.931812, 27.980967],
  [-99.841708, 27.766464],
  [-99.512219, 27.568094],
  [-99.480419, 27.481596],
  [-99.537771, 27.316073],
  [-99.441549, 27.24992],
  [-99.446524, 27.023008],
  [-99.268613, 26.843213],
  [-99.085126, 26.398782],
  [-98.807348, 26.369421],
  [-98.669397, 26.23632],
  [-98.450976, 26.219904],
  [-98.197046, 26.056153],
  [-97.649176, 26.021499],
  [-97.422636, 25.840378],
  [-97.350398, 25.925241],
  [-97.145567, 25.971132],
  [-97.152009, 26.062108],
  [-97.30462, 26.120727],
  [-97.287723, 26.275809],
  [-97.445708, 26.609362],
  [-97.42408, 27.264073],
  [-97.639094, 27.253131],
  [-97.501688, 27.366618],
  [-97.532223, 27.278577],
  [-97.404996, 27.329977],
  [-97.253955, 27.696696],
  [-97.368355, 27.741683],
  [-97.379042, 27.837867],
  [-97.514737, 27.870073],
  [-97.273698, 27.881633],
  [-97.187183, 27.824126],
  [-97.025859, 28.041939],
  [-97.046988, 28.115946],
  [-97.137238, 28.028068],
  [-97.217173, 28.073503],
  [-97.147015, 28.14172],
  [-97.037008, 28.185528],
  [-96.934765, 28.123873],
  [-96.800413, 28.224128],
  [-96.768352, 28.410389],
  [-96.665198, 28.30961],
  [-96.420032, 28.416902],
  [-96.440591, 28.34298],
  [-96.879942, 28.128767],
  [-97.082481, 27.913232],
  [-97.361464, 27.351988],
  [-97.389119, 26.800481],
  [-97.158798, 26.08266],
  [-97.366872, 26.885581],
  [-97.371741, 27.153012],
  [-97.257325, 27.510644],
  [-96.947572, 27.97094],
  [-96.303212, 28.441871],
  [-95.38239, 28.866348],
  [-94.73478, 29.32596],
  [-94.810696, 29.353435],
  [-95.16525, 29.113566],
  [-95.158512, 29.189133],
  [-94.893994, 29.30817],
  [-94.892099, 29.433413],
  [-94.951607, 29.466451],
  [-94.909465, 29.496838],
  [-95.018253, 29.554885],
  [-94.961929, 29.69665],
  [-94.893107, 29.661336],
  [-94.738837, 29.792058],
  [-94.69086, 29.690117],
  [-94.780938, 29.531093],
  [-94.466259, 29.552281],
  [-94.681541, 29.471389],
  [-94.778691, 29.361483],
  [-94.095762, 29.660524],
  [-93.837725, 29.679024],
  [-93.927992, 29.80964],
  [-93.699396, 30.05925],
  [-93.706608, 30.281187],
  [-93.765822, 30.333318],
  [-93.6978, 30.440583],
  [-93.740253, 30.539569],
  [-93.561666, 30.807739],
  [-93.526245, 30.939411],
  [-93.571906, 30.987614],
  [-93.516407, 31.02955],
  [-93.533307, 31.184463],
  [-93.600308, 31.176158],
  [-93.726736, 31.5116],
  [-93.834924, 31.586211],
  [-93.822598, 31.773559],
  [-94.041833, 31.992402],
  [-94.056096, 33.567252],
  [-94.392573, 33.551142],
  [-94.459198, 33.645146],
  [-94.520725, 33.616567],
  [-94.768057, 33.753446],
  [-94.8693, 33.745871],
  [-94.968895, 33.860916],
  [-95.226393, 33.961954],
  [-95.287865, 33.874946],
  [-95.545197, 33.880294],
  [-95.599678, 33.934247],
  [-95.772067, 33.843817],
  [-95.935198, 33.887101],
  [-96.14807, 33.837799],
  [-96.178059, 33.760518],
  [-96.292482, 33.766419],
  [-96.348306, 33.686379],
  [-96.422643, 33.776041],
  [-96.62929, 33.845488],
  [-96.587934, 33.894784],
  [-96.667187, 33.91694],
  [-96.761588, 33.824406],
  [-96.981337, 33.956378],
  [-97.126102, 33.716941],
  [-97.210921, 33.916064],
  [-97.426493, 33.819398],
  [-97.460376, 33.903948],
  [-97.587441, 33.902479],
  [-97.671772, 33.99137],
  [-97.834333, 33.857671],
  [-97.967777, 33.88243],
  [-97.94573, 33.989839],
  [-98.088203, 34.005481],
  [-98.109462, 34.154111],
  [-98.16912, 34.114171],
  [-98.364023, 34.157109],
  [-98.486328, 34.062598],
  [-98.599789, 34.160571],
  [-98.757037, 34.124633],
  [-98.987294, 34.221223],
  [-99.189511, 34.214312],
  [-99.213135, 34.340369],
  [-99.358795, 34.455863],
  [-99.40296, 34.373481],
  [-99.569696, 34.418418],
  [-99.696462, 34.381036],
  [-99.923211, 34.574552],
  [-100.000381, 34.560509],
  [-100.000406, 36.499702],
  [-103.041924, 36.500439],
  [-103.064423, 32.000518],
  [-106.618486, 32.000495],
  [-106.64084, 31.904598]
];

const assertValidViewport = (viewport: TexasMapViewport) => {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || !Number.isFinite(viewport.padding)
    || viewport.width <= viewport.padding * 2
    || viewport.height <= viewport.padding * 2
    || viewport.padding < 0
  ) {
    throw new RangeError('Texas map viewport must have finite dimensions and non-negative padding.');
  }
};

export const isWithinTexasGeographicBounds = ({
  latitude,
  longitude
}: TexasGeographicCoordinate) => (
  Number.isFinite(latitude)
  && Number.isFinite(longitude)
  && longitude >= TEXAS_GEOGRAPHIC_BOUNDS.west
  && longitude <= TEXAS_GEOGRAPHIC_BOUNDS.east
  && latitude >= TEXAS_GEOGRAPHIC_BOUNDS.south
  && latitude <= TEXAS_GEOGRAPHIC_BOUNDS.north
);

/**
 * Projects longitude/latitude into a north-up SVG viewport. The viewport's
 * aspect ratio is chosen to approximate an equirectangular Texas map near 31°N.
 */
export const projectTexasCoordinate = (
  coordinate: TexasGeographicCoordinate,
  viewport: TexasMapViewport = TEXAS_MAP_VIEWPORT
): TexasMapPoint => {
  assertValidViewport(viewport);
  if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
    throw new RangeError('Texas map coordinates must be finite.');
  }

  const drawableWidth = viewport.width - viewport.padding * 2;
  const drawableHeight = viewport.height - viewport.padding * 2;
  const longitudeProgress = (
    coordinate.longitude - TEXAS_GEOGRAPHIC_BOUNDS.west
  ) / (TEXAS_GEOGRAPHIC_BOUNDS.east - TEXAS_GEOGRAPHIC_BOUNDS.west);
  const latitudeProgress = (
    TEXAS_GEOGRAPHIC_BOUNDS.north - coordinate.latitude
  ) / (TEXAS_GEOGRAPHIC_BOUNDS.north - TEXAS_GEOGRAPHIC_BOUNDS.south);

  return {
    x: viewport.padding + longitudeProgress * drawableWidth,
    y: viewport.padding + latitudeProgress * drawableHeight
  };
};

export const projectTexasCity = (
  city: TexasVenueCity,
  viewport: TexasMapViewport = TEXAS_MAP_VIEWPORT
) => projectTexasCoordinate(TEXAS_CITY_COORDINATES[city], viewport);

const formatSvgCoordinate = (value: number) => String(Number(value.toFixed(2)));

export const createTexasOutlinePath = (
  viewport: TexasMapViewport = TEXAS_MAP_VIEWPORT
) => TEXAS_OUTLINE_COORDINATES.map(([longitude, latitude], index) => {
  const point = projectTexasCoordinate({ latitude, longitude }, viewport);
  return `${index === 0 ? 'M' : 'L'}${formatSvgCoordinate(point.x)} ${formatSvgCoordinate(point.y)}`;
}).join(' ') + ' Z';

export const TEXAS_OUTLINE_PATH = createTexasOutlinePath();
