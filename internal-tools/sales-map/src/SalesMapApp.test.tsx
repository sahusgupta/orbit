/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import SalesMapApp, {
  createMapClusters,
  createRouteMapStops,
  createVisibleRouteSegment,
  getTexasMapWindow
} from './SalesMapApp';
import { projectTexasCity, TEXAS_CITY_COORDINATES } from './texasMapGeometry';
import { texasVenues } from './texasVenues';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const renderView = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<SalesMapApp />));
  return container;
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText'
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const submitForm = (form: HTMLFormElement) => {
  act(() => form.requestSubmit());
};

const selectDirectoryVenue = (scope: HTMLElement, name: string) => {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>('.sales-directory-list button'))
    .find((candidate) => candidate.querySelector('strong')?.textContent === name);
  expect(button, `directory venue named "${name}"`).toBeTruthy();
  act(() => button?.click());
};

const toggleSelectedRouteVenue = (scope: HTMLElement) => {
  const button = scope.querySelector<HTMLButtonElement>('.sales-route-toggle-row button')!;
  button.focus();
  act(() => button.click());
  return button;
};

const getRouteVenueNames = (scope: HTMLElement) => Array.from(
  scope.querySelectorAll<HTMLElement>('.sales-route-list strong')
).map((node) => node.textContent);

const saveSelectedModel = (
  scope: HTMLElement,
  venueId: string,
  values: { cac: string; expectedNetValue: string; founderHours: string }
) => {
  setInputValue(scope.querySelector<HTMLInputElement>(`#sales-model-${venueId}-cac`)!, values.cac);
  setInputValue(
    scope.querySelector<HTMLInputElement>(`#sales-model-${venueId}-net-value`)!,
    values.expectedNetValue
  );
  setInputValue(
    scope.querySelector<HTMLInputElement>(`#sales-model-${venueId}-founder-hours`)!,
    values.founderHours
  );
  const form = scope.querySelector<HTMLFormElement>('.sales-opportunity-form')!;
  form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  submitForm(form);
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('SalesMapApp Texas venue map', () => {
  it('creates clamped state, regional, and city-area map windows', () => {
    const stateWindow = getTexasMapWindow('state');
    const elPasoCityWindow = getTexasMapWindow('city', projectTexasCity('El Paso'));
    const brownsvilleRegionWindow = getTexasMapWindow('region', projectTexasCity('Brownsville'));

    expect(stateWindow).toEqual(expect.objectContaining({
      height: 960,
      viewBox: '0 0 1000 960',
      width: 1000,
      x: 0,
      y: 0,
      zoom: 1
    }));
    expect(elPasoCityWindow.width).toBeCloseTo(1000 / 6);
    expect(elPasoCityWindow.x).toBe(0);
    expect(elPasoCityWindow.y).toBeGreaterThanOrEqual(0);
    expect(brownsvilleRegionWindow.y + brownsvilleRegionWindow.height).toBeCloseTo(960);
    expect(brownsvilleRegionWindow.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps fixed-size route directions inside every city-area window', () => {
    const cities = Object.keys(TEXAS_CITY_COORDINATES) as Array<keyof typeof TEXAS_CITY_COORDINATES>;
    const projectedCities = new Map(cities.map((city) => [city, projectTexasCity(city)] as const));
    let checkedSegmentCount = 0;
    cities.forEach((focusCity) => {
      const window = getTexasMapWindow('city', projectedCities.get(focusCity)!);
      cities.forEach((startCity) => {
        const start = projectedCities.get(startCity)!;
        const startVisible = start.x >= window.x && start.x <= window.x + window.width
          && start.y >= window.y && start.y <= window.y + window.height;
        cities.forEach((endCity) => {
          if (startCity === endCity) return;
          const end = projectedCities.get(endCity)!;
          const endVisible = end.x >= window.x && end.x <= window.x + window.width
            && end.y >= window.y && end.y <= window.y + window.height;
          if (!startVisible && !endVisible) return;
          const segment = createVisibleRouteSegment(start, end, window, 660);
          if (!segment) {
            throw new Error(`Expected ${startCity} -> ${endCity} to intersect the ${focusCity} city window`);
          }
          const arrowX = (segment.arrow.x - window.x) / window.width * 660;
          const arrowY = (segment.arrow.y - window.y) / window.height * (660 * .96);
          if (
            arrowX < 14.99
            || arrowX > 660 - 14.99
            || arrowY < 14.99
            || arrowY > 660 * .96 - 14.99
          ) {
            throw new Error(`Expected ${startCity} -> ${endCity} arrow to stay inside the ${focusCity} city window`);
          }
          checkedSegmentCount += 1;
        });
      });
    });
    expect(checkedSegmentCount).toBeGreaterThan(0);
  });

  it('reclusters and clamps markers for narrow maps while using major-city labels', () => {
    const desktopClusters = createMapClusters(texasVenues, new Map(), 750);
    const narrowViewportWidth = 280;
    const mapCanvasWidth = 660;
    const mapCanvasHeight = mapCanvasWidth * .96;
    const mobileClusters = createMapClusters(texasVenues, new Map(), narrowViewportWidth);

    expect(mobileClusters.length).toBeLessThan(desktopClusters.length);
    expect(mobileClusters.length).toBeGreaterThan(15);
    expect(desktopClusters.find(({ cities }) => cities.includes('Houston'))?.labelCity).toBe('Houston');
    expect(desktopClusters.find(({ cities }) => cities.includes('Dallas'))?.labelCity).toBe('Dallas');

    mobileClusters.forEach((cluster, index) => {
      const x = cluster.x / 1_000 * mapCanvasWidth;
      const y = cluster.y / 960 * mapCanvasHeight;
      expect(x).toBeGreaterThanOrEqual(cluster.markerSize / 2);
      expect(x).toBeLessThanOrEqual(mapCanvasWidth - cluster.markerSize / 2);
      expect(y).toBeGreaterThanOrEqual(cluster.markerSize / 2);
      expect(y).toBeLessThanOrEqual(mapCanvasHeight - cluster.markerSize / 2);

      cluster.cities.forEach((city) => {
        const point = projectTexasCity(city);
        const pointX = point.x / 1_000 * mapCanvasWidth;
        const pointY = point.y / 960 * mapCanvasHeight;
        expect(Math.hypot(x - pointX, y - pointY)).toBeLessThanOrEqual(52);
      });

      mobileClusters.slice(index + 1).forEach((other) => {
        const otherX = other.x / 1_000 * mapCanvasWidth;
        const otherY = other.y / 960 * mapCanvasHeight;
        expect(Math.hypot(x - otherX, y - otherY)).toBeGreaterThanOrEqual(47.9);
      });
    });

    const closestPair = mobileClusters.flatMap((cluster, index) => (
      mobileClusters.slice(index + 1).map((other) => ({
        cluster,
        other,
        distance: Math.hypot(cluster.x - other.x, cluster.y - other.y)
      }))
    )).sort((left, right) => left.distance - right.distance)[0];
    const weightedClusters = createMapClusters(texasVenues, new Map([
      [closestPair.cluster.venues[0].id, { weight: .5 }],
      [closestPair.other.venues[0].id, { weight: .5 }]
    ]), narrowViewportWidth);

    weightedClusters.forEach((cluster, index) => {
      expect(cluster.markerSize).toBeLessThanOrEqual(52);
      weightedClusters.slice(index + 1).forEach((other) => {
        const distance = Math.hypot(cluster.x - other.x, cluster.y - other.y)
          * mapCanvasWidth / 1_000;
        expect(distance).toBeGreaterThanOrEqual(
          (cluster.markerSize + other.markerSize) / 2 + 3.9
        );
      });
    });
  });

  it('uses the active zoom window to limit and separate city-area markers', () => {
    const cityWindow = getTexasMapWindow('city', projectTexasCity('Houston'));
    const cityClusters = createMapClusters(texasVenues, new Map(), 660, cityWindow);
    const cityVenueCount = cityClusters.reduce(
      (total, cluster) => total + cluster.venues.length,
      0
    );

    expect(cityVenueCount).toBeGreaterThan(13);
    expect(cityVenueCount).toBeLessThan(132);
    expect(Math.max(...cityClusters.map(({ cities }) => cities.length))).toBeLessThanOrEqual(2);
    cityClusters.forEach((cluster) => {
      expect(cluster.x).toBeGreaterThanOrEqual(cityWindow.x);
      expect(cluster.x).toBeLessThanOrEqual(cityWindow.x + cityWindow.width);
      expect(cluster.y).toBeGreaterThanOrEqual(cityWindow.y);
      expect(cluster.y).toBeLessThanOrEqual(cityWindow.y + cityWindow.height);
    });
  });

  it('keeps weighted regional markers separated after boundary clamping', () => {
    const regionWindow = getTexasMapWindow('region', projectTexasCity('Austin'));
    const mineralWellsVenue = texasVenues.find(({ city }) => city === 'Mineral Wells')!;
    const clusters = createMapClusters(
      texasVenues,
      new Map([[mineralWellsVenue.id, { weight: 1 }]]),
      660,
      regionWindow
    );

    clusters.forEach((cluster, index) => {
      clusters.slice(index + 1).forEach((other) => {
        const distanceInPixels = Math.hypot(cluster.x - other.x, cluster.y - other.y)
          * 660 / regionWindow.width;
        expect(distanceInPixels).toBeGreaterThanOrEqual(
          (cluster.markerSize + other.markerSize) / 2 + 3.9
        );
      });
    });
  });

  it('lays out dense route badges without overlapping their final rectangles', () => {
    const routeStopByVenueId = new Map(texasVenues.map((venue, index) => [venue.id, index + 1]));
    const assertNoBadgeOverlap = (
      badges: ReturnType<typeof createRouteMapStops>,
      canvasWidth: number,
      canvasHeight: number
    ) => badges.forEach((badge, index) => {
      const centerX = badge.xPercent / 100 * canvasWidth;
      const centerY = badge.yPercent / 100 * canvasHeight;
      badges.slice(index + 1).forEach((other) => {
        const otherCenterX = other.xPercent / 100 * canvasWidth;
        const otherCenterY = other.yPercent / 100 * canvasHeight;
        const separated = Math.abs(centerX - otherCenterX)
          >= (badge.estimatedWidth + other.estimatedWidth) / 2 + 3.9
          || Math.abs(centerY - otherCenterY)
          >= (badge.estimatedHeight + other.estimatedHeight) / 2 + 3.9;
        expect(separated).toBe(true);
      });
    });
    const stateBadges = createRouteMapStops(
      texasVenues,
      routeStopByVenueId,
      660,
      getTexasMapWindow('state')
    );
    assertNoBadgeOverlap(stateBadges, 660, 660 * .96);

    const regionWindow = getTexasMapWindow('region', projectTexasCity('Marble Falls'));
    const regionVenues = texasVenues.filter(({ city }) => (
      city === 'Austin' || city === 'Marble Falls'
    ));
    const regionBadges = createRouteMapStops(
      regionVenues,
      routeStopByVenueId,
      660,
      regionWindow
    );
    assertNoBadgeOverlap(regionBadges, 660, 660 * .96);

    (Object.keys(TEXAS_CITY_COORDINATES) as Array<keyof typeof TEXAS_CITY_COORDINATES>)
      .forEach((city) => {
        (['region', 'city'] as const).forEach((level) => {
          const window = getTexasMapWindow(level, projectTexasCity(city));
          assertNoBadgeOverlap(
            createRouteMapStops(texasVenues, routeStopByVenueId, 660, window),
            660,
            660 * .96
          );
        });
      });
  });

  it('loads all supplied venues on an offline Texas map without fabricating planning metrics', () => {
    const view = renderView();

    expect(view.textContent).toContain('Texas Poker Opportunity Map');
    expect(view.textContent).toContain('132 supplied venues · session-only planning inputs');
    expect(view.textContent).toContain('city representative point, not an exact venue address');
    expect(view.querySelector('.sales-texas-outline path')?.getAttribute('d')).toMatch(/^M\d/);
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(132);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(0);
    expect(view.querySelector<HTMLInputElement>('#sales-weight-balance')?.disabled).toBe(true);
    expect(view.querySelector<HTMLInputElement>('#sales-model-101-poker-club-katy-cac')?.value).toBe('');
    expect(view.querySelector<HTMLInputElement>('#sales-model-101-poker-club-katy-net-value')?.value).toBe('');
    expect(view.querySelector<HTMLInputElement>('#sales-model-101-poker-club-katy-founder-hours')?.value).toBe('');

    const markerVenueTotal = Array.from(view.querySelectorAll('.sales-marker-count'))
      .reduce((total, marker) => total + Number(marker.textContent), 0);
    expect(markerVenueTotal).toBe(132);
    expect(view.querySelectorAll('.sales-map-marker').length).toBeLessThan(63);
    expect(view.querySelectorAll('.sales-map-marker').length).toBeGreaterThan(10);
    expect(view.querySelector('.sales-map-marker')?.getAttribute('aria-label'))
      .toContain('Locations are city-level approximations.');
    expect(Array.from(view.querySelectorAll<HTMLButtonElement>('.sales-directory-list button'))
      .filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it('shows supplied advisories verbatim and finds venues by name, city, or note', () => {
    const view = renderView();
    const search = view.querySelector<HTMLInputElement>('#sales-venue-search')!;

    setInputValue(search, 'planned Fall 2026');

    expect(view.textContent).toContain('Showing 1 of 132 venues.');
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(1);
    expect(view.querySelector('.sales-opportunity-detail h2')?.textContent).toBe('Showdown Social Club');
    expect(view.querySelector('.sales-advisory')?.textContent).toContain('planned Fall 2026 opening');
    expect(Array.from(view.querySelectorAll('.sales-marker-count'))
      .reduce((total, marker) => total + Number(marker.textContent), 0)).toBe(1);

    setInputValue(search, 'Houston');
    expect(view.textContent).toContain('Showing 13 of 132 venues.');
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(13);
  });

  it('opens a keyboard-accessible venue list for a dense city marker', () => {
    const view = renderView();
    setInputValue(view.querySelector<HTMLInputElement>('#sales-venue-search')!, 'Houston');

    const marker = view.querySelector<HTMLButtonElement>('.sales-map-marker')!;
    expect(marker.getAttribute('aria-label')).toContain('13 venues');
    expect(marker.getAttribute('aria-label')).toContain('0 modeled');
    expect(marker.getAttribute('aria-label')).toContain('Contains the selected venue');
    expect(marker.getAttribute('aria-controls')).toBeNull();
    marker.focus();
    act(() => marker.click());

    expect(marker.getAttribute('aria-expanded')).toBe('true');
    expect(marker.getAttribute('aria-controls')).toMatch(/^sales-cluster-/);
    const clusterButtons = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-cluster-venue-list button')
    );
    expect(clusterButtons).toHaveLength(13);
    expect(clusterButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(document.activeElement).toBe(clusterButtons.find((button) => button.tabIndex === 0));

    act(() => clusterButtons[1].click());
    expect(view.querySelector('.sales-opportunity-detail h2')?.textContent)
      .toBe(clusterButtons[1].querySelector('strong')?.textContent);

    clusterButtons[1].focus();
    act(() => clusterButtons[1].dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Escape'
    })));
    expect(view.querySelector('.sales-cluster-browser')).toBeNull();
    expect(document.activeElement).toBe(marker);
    expect(marker.getAttribute('aria-controls')).toBeNull();
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(13);
  });

  it('does not steal focus from search when filtering invalidates an open cluster', () => {
    const view = renderView();
    const marker = view.querySelector<HTMLButtonElement>('.sales-map-marker')!;
    act(() => marker.click());
    expect(view.querySelector('.sales-cluster-browser')).toBeTruthy();

    const search = view.querySelector<HTMLInputElement>('#sales-venue-search')!;
    search.focus();
    setInputValue(search, 'Garland');

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('Garland');
  });

  it('centers the selected marker in the horizontally scrollable narrow map', () => {
    const view = renderView();
    const scrollRegion = view.querySelector<HTMLDivElement>('.sales-texas-map-scroll')!;
    Object.defineProperties(scrollRegion, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 660 }
    });
    scrollRegion.scrollLeft = 0;

    selectDirectoryVenue(view, 'Texline Card House');

    expect(scrollRegion.scrollLeft).toBeGreaterThan(0);
    expect(scrollRegion.scrollLeft).toBeLessThanOrEqual(360);
  });

  it('switches among Texas, region, and city views and recenters on selection', () => {
    const view = renderView();
    const mapSvg = view.querySelector<SVGSVGElement>('.sales-texas-outline')!;
    const viewButton = (label: string) => Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-map-view-presets button')
    ).find((button) => button.textContent === label)!;

    expect(mapSvg.getAttribute('viewBox')).toBe('0 0 1000 960');
    const regionButton = viewButton('Region');
    regionButton.focus();
    act(() => regionButton.click());
    const regionViewBox = mapSvg.getAttribute('viewBox');
    expect(regionViewBox).not.toBe('0 0 1000 960');
    expect(regionButton.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(regionButton);
    expect(view.querySelector('.sales-map-view-status')?.textContent).toContain('Region around Katy');

    act(() => viewButton('City').click());
    const katyCityViewBox = mapSvg.getAttribute('viewBox');
    expect(katyCityViewBox).not.toBe(regionViewBox);
    expect(view.querySelector('.sales-texas-outline text')).toBeNull();

    selectDirectoryVenue(view, 'Texline Card House');
    expect(mapSvg.getAttribute('viewBox')).not.toBe(katyCityViewBox);
    expect(view.querySelector('.sales-map-view-status')?.textContent).toContain('Texarkana city-area');

    act(() => viewButton('Texas').click());
    expect(mapSvg.getAttribute('viewBox')).toBe('0 0 1000 960');
    expect(view.querySelector('.sales-texas-outline text')?.textContent).toBe('TEXAS');
  });

  it('keeps the selected city as the zoom anchor when filters have no matches', () => {
    const view = renderView();
    const cityButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-map-view-presets button')
    ).find((button) => button.textContent === 'City')!;
    act(() => cityButton.click());
    const mapSvg = view.querySelector<SVGSVGElement>('.sales-texas-outline')!;
    const anchoredViewBox = mapSvg.getAttribute('viewBox');

    setInputValue(
      view.querySelector<HTMLInputElement>('#sales-venue-search')!,
      'no such supplied venue'
    );

    expect(mapSvg.getAttribute('viewBox')).toBe(anchoredViewBox);
    expect(view.querySelector('.sales-map-view-status')?.textContent).toContain('Katy city-area');
    expect(cityButton.disabled).toBe(false);
    expect(view.textContent).toContain('No catalog markers match this view');
  });

  it('draws and preserves a numbered red call sequence independently of filters', () => {
    const view = renderView();
    const toggle = toggleSelectedRouteVenue(view);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(getRouteVenueNames(view)).toEqual(['101 Poker Club']);
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(0);

    selectDirectoryVenue(view, '20to1 Social Club');
    toggleSelectedRouteVenue(view);
    expect(getRouteVenueNames(view)).toEqual(['101 Poker Club', '20to1 Social Club']);
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(1);
    const routeLine = view.querySelector<SVGLineElement>('.sales-route-line')!;
    const katyPoint = projectTexasCity('Katy');
    const garlandPoint = projectTexasCity('Garland');
    const lineStart = {
      x: Number(routeLine.getAttribute('x1')),
      y: Number(routeLine.getAttribute('y1'))
    };
    const lineEnd = {
      x: Number(routeLine.getAttribute('x2')),
      y: Number(routeLine.getAttribute('y2'))
    };
    expect(Math.hypot(lineStart.x - katyPoint.x, lineStart.y - katyPoint.y)).toBeGreaterThan(0);
    expect(Math.hypot(lineStart.x - katyPoint.x, lineStart.y - katyPoint.y)).toBeLessThan(50);
    expect(Math.hypot(lineEnd.x - garlandPoint.x, lineEnd.y - garlandPoint.y)).toBeGreaterThan(0);
    expect(Math.hypot(lineEnd.x - garlandPoint.x, lineEnd.y - garlandPoint.y)).toBeLessThan(50);
    expect(routeLine.dataset.startStop).toBe('1');
    expect(routeLine.dataset.endStop).toBe('2');
    expect(view.querySelectorAll('.sales-route-direction')).toHaveLength(1);
    expect(view.querySelectorAll('.sales-route-map-stop')).toHaveLength(2);
    expect(view.querySelector('.sales-route-list')?.getAttribute('aria-describedby'))
      .toBe('sales-route-help');

    const search = view.querySelector<HTMLInputElement>('#sales-venue-search')!;
    setInputValue(search, 'no such supplied venue');
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(0);
    expect(getRouteVenueNames(view)).toEqual(['101 Poker Club', '20to1 Social Club']);
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(1);
  });

  it('represents same-city calls as separate ordered stops at one shared point', () => {
    const view = renderView();
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, 'Katy Poker');
    toggleSelectedRouteVenue(view);

    expect(getRouteVenueNames(view)).toEqual(['101 Poker Club', 'Katy Poker']);
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(0);
    expect(view.querySelectorAll('.sales-route-map-stop')).toHaveLength(1);
    expect(view.querySelector('.sales-route-map-stop')?.textContent).toBe('1, 2');
  });

  it('separates reverse route legs and preserves both directions', () => {
    const view = renderView();
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, '9 Dragons Social Club');
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, 'Katy Poker');
    toggleSelectedRouteVenue(view);

    expect(getRouteVenueNames(view)).toEqual([
      '101 Poker Club',
      '9 Dragons Social Club',
      'Katy Poker'
    ]);
    const lines = Array.from(view.querySelectorAll<SVGLineElement>('.sales-route-line'));
    const directions = Array.from(view.querySelectorAll<HTMLElement>('.sales-route-direction'));
    expect(lines).toHaveLength(2);
    expect(directions).toHaveLength(2);
    expect(Number(lines[0].getAttribute('x1'))).toBeCloseTo(Number(lines[1].getAttribute('x2')));
    expect(Number(lines[0].getAttribute('y1'))).toBeCloseTo(Number(lines[1].getAttribute('y2')));
    const firstDirection = {
      x: Number.parseFloat(directions[0].style.getPropertyValue('--sales-route-direction-x')),
      y: Number.parseFloat(directions[0].style.getPropertyValue('--sales-route-direction-y'))
    };
    const secondDirection = {
      x: Number.parseFloat(directions[1].style.getPropertyValue('--sales-route-direction-x')),
      y: Number.parseFloat(directions[1].style.getPropertyValue('--sales-route-direction-y'))
    };
    expect(Math.hypot(
      (firstDirection.x - secondDirection.x) / 100 * 750,
      (firstDirection.y - secondDirection.y) / 100 * 720
    )).toBeGreaterThanOrEqual(26);
    expect(Array.from(view.querySelectorAll('.sales-route-map-stop')).map(({ textContent }) => (
      textContent
    ))).toEqual(['1, 2, 3']);
  });

  it('compresses repeated edge-city legs without dropping either direction', () => {
    const view = renderView();
    [
      'Bluefelt El Paso Card Club',
      'Elite Poker Lounge Brownsville',
      'The Club EPTX / The Club Poker House',
      'Royal Flush Social Club',
      'House of Kings Card Club',
      'Suits Social Club',
      'Speaking Rock Entertainment'
    ].forEach((venueName) => {
      selectDirectoryVenue(view, venueName);
      toggleSelectedRouteVenue(view);
    });

    expect(getRouteVenueNames(view)).toHaveLength(7);
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(2);
    expect(view.querySelectorAll('.sales-route-direction')).toHaveLength(2);
    expect(Array.from(view.querySelectorAll('.sales-route-map-stop')).map(({ textContent }) => (
      textContent
    ))).toEqual(expect.arrayContaining(['1, 3 +2', '2, 4, 6']));
  });

  it('keeps both reverse directions when a city-area window grazes one endpoint', () => {
    const view = renderView();
    [
      'Amarillo Social Club',
      'Showdown Social Club',
      'VIP Social Club'
    ].forEach((venueName) => {
      selectDirectoryVenue(view, venueName);
      toggleSelectedRouteVenue(view);
    });
    selectDirectoryVenue(view, 'The Fort Card Room');
    const cityButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-map-view-presets button')
    ).find((button) => button.textContent === 'City')!;
    act(() => cityButton.click());

    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(2);
    const directions = Array.from(view.querySelectorAll<HTMLElement>('.sales-route-direction'));
    expect(directions).toHaveLength(2);
    directions.forEach((direction) => {
      const x = Number.parseFloat(direction.style.getPropertyValue('--sales-route-direction-x'));
      const y = Number.parseFloat(direction.style.getPropertyValue('--sales-route-direction-y'));
      expect(x).toBeGreaterThanOrEqual(15 / 750 * 100 - .01);
      expect(x).toBeLessThanOrEqual(100 - 15 / 750 * 100 + .01);
      expect(y).toBeGreaterThanOrEqual(15 / 720 * 100 - .01);
      expect(y).toBeLessThanOrEqual(100 - 15 / 720 * 100 + .01);
    });
  });

  it('shows direction for a route touching the zoom window and hides unrelated fragments', () => {
    const view = renderView();
    selectDirectoryVenue(view, 'Bluefelt El Paso Card Club');
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, '9 Dragons Social Club');
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, 'Bullets Card Club');
    const cityButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-map-view-presets button')
    ).find((button) => button.textContent === 'City')!;
    act(() => cityButton.click());

    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(0);
    expect(view.querySelectorAll('.sales-route-direction')).toHaveLength(0);

    selectDirectoryVenue(view, '9 Dragons Social Club');
    expect(view.querySelectorAll('.sales-route-line')).toHaveLength(1);
    const direction = view.querySelector<HTMLElement>('.sales-route-direction')!;
    expect(direction.style.getPropertyValue('--sales-route-direction-x')).toMatch(/%$/);
    expect(direction.style.getPropertyValue('--sales-route-direction-y')).toMatch(/%$/);
    expect(direction.style.getPropertyValue('--sales-route-direction-angle')).toMatch(/deg$/);
  });

  it('supports manual route movement and restores focus after clearing', () => {
    const view = renderView();
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, '20to1 Social Club');
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, 'Texline Card House');
    toggleSelectedRouteVenue(view);

    const earlierButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-edit-actions button')
    ).find((button) => button.textContent?.includes('Earlier'))!;
    earlierButton.focus();
    act(() => earlierButton.click());
    expect(getRouteVenueNames(view)).toEqual([
      '101 Poker Club',
      'Texline Card House',
      '20to1 Social Club'
    ]);
    expect(document.activeElement).toBe(earlierButton);

    act(() => earlierButton.click());
    expect(getRouteVenueNames(view)).toEqual([
      'Texline Card House',
      '101 Poker Club',
      '20to1 Social Club'
    ]);
    const laterButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-edit-actions button')
    ).find((button) => button.textContent?.includes('Later'))!;
    expect(document.activeElement).toBe(laterButton);

    act(() => laterButton.click());
    act(() => laterButton.click());
    expect(getRouteVenueNames(view)).toEqual([
      '101 Poker Club',
      '20to1 Social Club',
      'Texline Card House'
    ]);
    expect(document.activeElement).toBe(earlierButton);

    const clearButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-order-actions button')
    ).find((button) => button.textContent?.includes('Clear'))!;
    act(() => clearButton.click());
    const routeHeading = view.querySelector<HTMLHeadingElement>('#sales-route-heading')!;
    expect(getRouteVenueNames(view)).toEqual([]);
    expect(document.activeElement).toBe(routeHeading);
  });

  it('moves focus to the neighboring stop after removing from the route editor', () => {
    const view = renderView();
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, '20to1 Social Club');
    toggleSelectedRouteVenue(view);
    const removeButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-edit-actions button')
    ).find((button) => button.textContent?.includes('Remove stop'))!;

    removeButton.focus();
    act(() => removeButton.click());

    expect(getRouteVenueNames(view)).toEqual(['101 Poker Club']);
    const remainingRouteButton = view.querySelector<HTMLButtonElement>('.sales-route-list button')!;
    expect(document.activeElement).toBe(remainingRouteButton);
    expect(remainingRouteButton.getAttribute('aria-current')).toBe('step');

    act(() => removeButton.click());
    expect(getRouteVenueNames(view)).toEqual([]);
    expect(document.activeElement).toBe(
      view.querySelector<HTMLHeadingElement>('#sales-route-heading')
    );
  });

  it('applies normalized priority explicitly while retaining an unmodeled final stop', () => {
    const view = renderView();
    selectDirectoryVenue(view, 'Texline Card House');
    toggleSelectedRouteVenue(view);
    selectDirectoryVenue(view, '20to1 Social Club');
    toggleSelectedRouteVenue(view);
    saveSelectedModel(view, '20to1-social-club-garland', {
      cac: '300', expectedNetValue: '1000', founderHours: '10'
    });
    selectDirectoryVenue(view, '101 Poker Club');
    toggleSelectedRouteVenue(view);
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '100', expectedNetValue: '1000', founderHours: '10'
    });

    const priorityButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-order-actions button')
    ).find((button) => button.textContent?.includes('Priority'))!;
    act(() => priorityButton.click());

    expect(getRouteVenueNames(view)).toEqual([
      '101 Poker Club',
      '20to1 Social Club',
      'Texline Card House'
    ]);
    expect(view.querySelector('.sales-route-list li:last-child em')?.textContent).toBe('Unmodeled');
  });

  it('orders the rendered route by proximity while retaining the first stop', () => {
    const view = renderView();
    [
      'Bluefelt El Paso Card Club',
      '9 Dragons Social Club',
      'Basin Poker Club',
      'Celebrity Card Club Odessa'
    ].forEach((venueName) => {
      selectDirectoryVenue(view, venueName);
      toggleSelectedRouteVenue(view);
    });

    const proximityButton = Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-route-order-actions button')
    ).find((button) => button.textContent?.includes('Proximity'))!;
    expect(proximityButton.getAttribute('aria-label')).toContain('Bluefelt El Paso Card Club');
    act(() => proximityButton.click());

    expect(getRouteVenueNames(view)).toEqual([
      'Bluefelt El Paso Card Club',
      'Celebrity Card Club Odessa',
      'Basin Poker Club',
      '9 Dragons Social Club'
    ]);
    const firstLine = view.querySelector<SVGLineElement>('.sales-route-line')!;
    const elPasoPoint = projectTexasCity('El Paso');
    const odessaPoint = projectTexasCity('Odessa');
    const start = {
      x: Number(firstLine.getAttribute('x1')),
      y: Number(firstLine.getAttribute('y1'))
    };
    const end = {
      x: Number(firstLine.getAttribute('x2')),
      y: Number(firstLine.getAttribute('y2'))
    };
    expect(Math.hypot(start.x - elPasoPoint.x, start.y - elPasoPoint.y))
      .toBeLessThan(Math.hypot(start.x - odessaPoint.x, start.y - odessaPoint.y));
    expect(Math.hypot(end.x - odessaPoint.x, end.y - odessaPoint.y))
      .toBeLessThan(Math.hypot(end.x - elPasoPoint.x, end.y - elPasoPoint.y));
    expect(view.querySelector('.sr-only[role="status"]')?.textContent)
      .toContain('ordered by geographic proximity');
  });

  it('keeps filtered save and clear actions focused after their venue leaves the view', () => {
    const view = renderView();
    const filterButton = (label: string) => Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-filter-group button')
    ).find((button) => button.textContent === label)!;

    act(() => filterButton('Not modeled').click());
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '125',
      expectedNetValue: '1200',
      founderHours: '4'
    });

    const nextHeading = view.querySelector<HTMLHeadingElement>('.sales-opportunity-detail h2')!;
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(131);
    expect(nextHeading.textContent).not.toBe('101 Poker Club');
    expect(document.activeElement).toBe(nextHeading);

    act(() => filterButton('Modeled').click());
    const clearButton = Array.from(view.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.replace(/\s+/g, ' ').trim() === 'Clear planning inputs')!;
    act(() => clearButton.click());

    const showAllButton = view.querySelector<HTMLButtonElement>('.sales-no-selection button')!;
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(0);
    expect(document.activeElement).toBe(showAllButton);
  });

  it('adds optional metrics to normalization without moving the geographic marker', () => {
    const view = renderView();
    const markerBefore = view.querySelector<HTMLButtonElement>('.sales-map-marker.selected')!;
    const positionBefore = [
      markerBefore.style.getPropertyValue('--sales-marker-x'),
      markerBefore.style.getPropertyValue('--sales-marker-y')
    ];

    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '100',
      expectedNetValue: '1000',
      founderHours: '10'
    });

    const markerAfter = view.querySelector<HTMLButtonElement>('.sales-map-marker.selected')!;
    expect([
      markerAfter.style.getPropertyValue('--sales-marker-x'),
      markerAfter.style.getPropertyValue('--sales-marker-y')
    ]).toEqual(positionBefore);
    expect(markerAfter.classList.contains('modeled')).toBe(true);
    expect(view.querySelector<HTMLInputElement>('#sales-weight-balance')?.disabled).toBe(false);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(1);
    expect(view.querySelector('.sales-weight-breakdown')?.textContent).toContain('$100.00');
    expect(view.querySelector('.sales-weight-breakdown')?.textContent).toContain('100%');
    expect(view.textContent).toContain('across modeled venues only');
    expect(document.activeElement?.textContent).toContain('Update weighting');
  });

  it('keeps normalization cohort-wide when search and filters change visibility', () => {
    const view = renderView();
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '100',
      expectedNetValue: '1000',
      founderHours: '10'
    });
    selectDirectoryVenue(view, '20to1 Social Club');
    saveSelectedModel(view, '20to1-social-club-garland', {
      cac: '300',
      expectedNetValue: '4000',
      founderHours: '10'
    });

    expect(Array.from(view.querySelectorAll('.sales-ranking-list em')).map((node) => node.textContent))
      .toEqual(['50%', '50%']);
    setInputValue(view.querySelector<HTMLInputElement>('#sales-weight-balance')!, '100');
    expect(Array.from(view.querySelectorAll('.sales-ranking-list em')).map((node) => node.textContent))
      .toEqual(['100%', '0%']);

    setInputValue(view.querySelector<HTMLInputElement>('#sales-venue-search')!, '101 Poker');
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(1);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(2);
    expect(Array.from(view.querySelectorAll('.sales-ranking-list em')).map((node) => node.textContent))
      .toEqual(['100%', '0%']);
    expect(view.textContent).toContain('Filtering changes visibility, not normalized weights.');

    setInputValue(view.querySelector<HTMLInputElement>('#sales-venue-search')!, '');
    const filterButton = (label: string) => Array.from(
      view.querySelectorAll<HTMLButtonElement>('.sales-filter-group button')
    ).find((button) => button.textContent === label)!;
    act(() => filterButton('Modeled').click());
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(2);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(2);
    expect(Array.from(view.querySelectorAll('.sales-ranking-list em')).map((node) => node.textContent))
      .toEqual(['100%', '0%']);

    act(() => filterButton('Not modeled').click());
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(130);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(2);

    act(() => filterButton('Has advisory').click());
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(61);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(2);
  });

  it('shows a coherent no-selection state when a filter has no matches', () => {
    const view = renderView();
    const modeledFilter = Array.from(view.querySelectorAll<HTMLButtonElement>('.sales-filter-group button'))
      .find((button) => button.textContent === 'Modeled')!;

    act(() => modeledFilter.click());

    expect(view.querySelectorAll('.sales-map-marker')).toHaveLength(0);
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(0);
    expect(view.querySelector('.sales-no-selection h2')?.textContent).toBe('No venue matches this view');
    expect(view.querySelector('.sales-opportunity-form')).toBeNull();

    const showAll = Array.from(view.querySelectorAll<HTMLButtonElement>('.sales-no-selection button'))
      .find((button) => button.textContent?.includes('Show all venues'))!;
    act(() => showAll.click());
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(132);
    expect(view.querySelector('.sales-opportunity-detail h2')?.textContent).toBe('101 Poker Club');
  });

  it('does not expose a latent ranking selection when search has no visible venue', () => {
    const view = renderView();
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '100',
      expectedNetValue: '1000',
      founderHours: '5'
    });

    setInputValue(view.querySelector<HTMLInputElement>('#sales-venue-search')!, 'no such venue');

    const rankingButton = view.querySelector<HTMLButtonElement>('.sales-ranking-list button')!;
    expect(view.querySelector('.sales-no-selection')).toBeTruthy();
    expect(rankingButton.getAttribute('aria-current')).toBeNull();
    expect(rankingButton.classList.contains('active')).toBe(false);
    expect(rankingButton.tabIndex).toBe(0);
  });

  it('clears planning inputs without removing the supplied venue', () => {
    const view = renderView();
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '180',
      expectedNetValue: '900',
      founderHours: '3'
    });

    const clearButton = Array.from(view.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.replace(/\s+/g, ' ').trim() === 'Clear planning inputs')!;
    act(() => clearButton.click());

    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(132);
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(0);
    expect(view.textContent).toContain('Not modeled');
    expect(view.querySelector<HTMLInputElement>('#sales-weight-balance')?.disabled).toBe(true);
    expect(view.querySelector('.sales-opportunity-detail h2')?.textContent).toBe('101 Poker Club');
    expect(document.activeElement)
      .toBe(view.querySelector('#sales-model-101-poker-club-katy-cac'));
  });

  it('rejects numeric overflow while keeping the catalog and Texas map mounted', () => {
    const view = renderView();

    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '100',
      expectedNetValue: '1e307',
      founderHours: '0.01'
    });

    const error = view.querySelector<HTMLElement>('#sales-model-101-poker-club-katy-error')!;
    expect(error.textContent).toContain('too large to calculate a reliable normalized score');
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(0);
    expect(view.querySelectorAll('.sales-directory-list button')).toHaveLength(132);
    expect(view.querySelector('.sales-texas-outline path')).toBeTruthy();
  });

  it('restores the catalog but clears session-only planning inputs after remounting', () => {
    const view = renderView();
    toggleSelectedRouteVenue(view);
    saveSelectedModel(view, '101-poker-club-katy', {
      cac: '180',
      expectedNetValue: '900',
      founderHours: '3'
    });
    expect(view.querySelectorAll('.sales-ranking-list button')).toHaveLength(1);
    expect(view.querySelectorAll('.sales-route-list button')).toHaveLength(1);

    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;

    const freshView = renderView();
    expect(freshView.querySelectorAll('.sales-directory-list button')).toHaveLength(132);
    expect(freshView.querySelectorAll('.sales-ranking-list button')).toHaveLength(0);
    expect(freshView.querySelectorAll('.sales-route-list button')).toHaveLength(0);
    expect(freshView.querySelector<HTMLInputElement>('#sales-weight-balance')?.disabled).toBe(true);
  });
});
