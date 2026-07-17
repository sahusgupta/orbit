import React from 'react';
import { Image, PanResponder, Pressable, Text, View, type DimensionValue } from 'react-native';

type Coordinate = {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
};

type MapViewProps = {
  children?: React.ReactNode;
  style?: object | object[];
  onPress?: (event: { nativeEvent: { coordinate: Coordinate } }) => void;
  initialRegion?: Coordinate;
  provider?: string;
};

type MarkerProps = {
  coordinate: Coordinate;
  title?: string;
  description?: string;
  pinColor?: string;
  onPress?: () => void;
};

export const PROVIDER_GOOGLE = 'google';

type RequiredCoordinate = Required<Coordinate>;
type MapProjection = RequiredCoordinate & {
  centerTileX: number;
  centerTileY: number;
  tileHeightPercent: number;
  tileWidthPercent: number;
  zoom: number;
};

const defaultRegion: RequiredCoordinate = {
  latitude: 30.613,
  longitude: -96.342,
  latitudeDelta: 0.55,
  longitudeDelta: 0.55
};

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const clampLatitude = (latitude: number) => Math.max(-85.0511, Math.min(85.0511, latitude));
const getTileCount = (zoom: number) => 2 ** zoom;
const longitudeToTileX = (longitude: number, zoom: number) => ((longitude + 180) / 360) * getTileCount(zoom);
const latitudeToTileY = (latitude: number, zoom: number) => {
  const latRad = degreesToRadians(clampLatitude(latitude));
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * getTileCount(zoom);
};
const getRegionZoom = (region: RequiredCoordinate) =>
  Math.max(5, Math.min(16, Math.round(Math.log2(360 / Math.max(0.05, region.longitudeDelta))) + 1));
const wrapTileX = (x: number, zoom: number) => {
  const tileCount = getTileCount(zoom);
  return ((x % tileCount) + tileCount) % tileCount;
};
const clampTileY = (y: number, zoom: number) => Math.max(0, Math.min(getTileCount(zoom) - 1, y));

const getProjection = (region: RequiredCoordinate): MapProjection => {
  const zoom = getRegionZoom(region);
  const centerTileX = longitudeToTileX(region.longitude, zoom);
  const centerTileY = latitudeToTileY(region.latitude, zoom);
  const leftTileX = longitudeToTileX(region.longitude - region.longitudeDelta / 2, zoom);
  const rightTileX = longitudeToTileX(region.longitude + region.longitudeDelta / 2, zoom);
  const topTileY = latitudeToTileY(region.latitude + region.latitudeDelta / 2, zoom);
  const bottomTileY = latitudeToTileY(region.latitude - region.latitudeDelta / 2, zoom);
  const visibleTilesX = Math.max(0.8, Math.abs(rightTileX - leftTileX));
  const visibleTilesY = Math.max(0.8, Math.abs(bottomTileY - topTileY));
  return {
    ...region,
    centerTileX,
    centerTileY,
    tileHeightPercent: 100 / visibleTilesY,
    tileWidthPercent: 100 / visibleTilesX,
    zoom
  };
};

const defaultProjection = getProjection(defaultRegion);
const MapRegionContext = React.createContext<MapProjection>(defaultProjection);

export function Circle(_props: Record<string, unknown>) {
  return null;
}

export function Marker({ coordinate, title, description, pinColor = '#38506d', onPress }: MarkerProps) {
  const projection = React.useContext(MapRegionContext);
  const leftPercent = 50 + (longitudeToTileX(coordinate.longitude, projection.zoom) - projection.centerTileX) * projection.tileWidthPercent;
  const topPercent = 50 + (latitudeToTileY(coordinate.latitude, projection.zoom) - projection.centerTileY) * projection.tileHeightPercent;
  const left = `${Math.max(5, Math.min(92, leftPercent))}%` as DimensionValue;
  const top = `${Math.max(7, Math.min(85, topPercent))}%` as DimensionValue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title || 'Map pin'}
      onPress={onPress}
      style={{
        alignItems: 'center',
        left,
        position: 'absolute',
        top,
        transform: [{ translateX: -18 }, { translateY: -18 }],
        zIndex: 4
      }}
    >
      <View
        style={{
          backgroundColor: pinColor,
          borderColor: '#ffffff',
          borderRadius: 999,
          borderWidth: 2,
          height: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
          width: 20
        }}
      />
      {title ? (
        <Text
          style={{
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderRadius: 8,
            color: '#181716',
            fontSize: 11,
            fontWeight: '800',
            marginTop: 5,
            maxWidth: 132,
            paddingHorizontal: 7,
            paddingVertical: 4,
            textAlign: 'center'
          }}
        >
          {description ? `${title}` : title}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function MapView({ children, style, onPress, initialRegion }: MapViewProps) {
  const initialMapRegion = {
    latitude: initialRegion?.latitude ?? defaultRegion.latitude,
    longitude: initialRegion?.longitude ?? defaultRegion.longitude,
    latitudeDelta: initialRegion?.latitudeDelta ?? defaultRegion.latitudeDelta,
    longitudeDelta: initialRegion?.longitudeDelta ?? defaultRegion.longitudeDelta
  };
  const [region, setRegion] = React.useState(initialMapRegion);
  const [mapSize, setMapSize] = React.useState({ width: 1, height: 1 });
  const regionRef = React.useRef(region);
  const isMouseDragging = React.useRef(false);
  const mouseDragStart = React.useRef({ x: 0, y: 0 });
  const dragStartRegion = React.useRef(region);
  const mapOverlayRef = React.useRef<React.ElementRef<typeof View> | null>(null);

  React.useEffect(() => {
    setRegion(initialMapRegion);
  }, [initialMapRegion.latitude, initialMapRegion.latitudeDelta, initialMapRegion.longitude, initialMapRegion.longitudeDelta]);

  React.useEffect(() => {
    regionRef.current = region;
  }, [region]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStartRegion.current = region;
        },
        onPanResponderMove: (_event, gesture) => {
          setRegion({
            ...dragStartRegion.current,
            latitude: clampLatitude(dragStartRegion.current.latitude + (gesture.dy / mapSize.height) * dragStartRegion.current.latitudeDelta),
            longitude: dragStartRegion.current.longitude - (gesture.dx / mapSize.width) * dragStartRegion.current.longitudeDelta
          });
        },
        onPanResponderRelease: (event, gesture) => {
          if (!onPress || Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3) return;
          const locationX = event.nativeEvent.locationX ?? mapSize.width / 2;
          const locationY = event.nativeEvent.locationY ?? mapSize.height / 2;
          onPress({
            nativeEvent: {
              coordinate: {
                latitude: region.latitude - (locationY / mapSize.height - 0.5) * region.latitudeDelta,
                longitude: region.longitude + (locationX / mapSize.width - 0.5) * region.longitudeDelta
              }
            }
          });
        }
      }),
    [mapSize.height, mapSize.width, onPress, region]
  );

  const zoomBy = React.useCallback((factor: number) => {
    setRegion((current) => ({
      ...current,
      latitudeDelta: Math.max(0.04, Math.min(8, current.latitudeDelta * factor)),
      longitudeDelta: Math.max(0.04, Math.min(8, current.longitudeDelta * factor))
    }));
  }, []);

  React.useEffect(() => {
    const overlay = mapOverlayRef.current as unknown as HTMLElement | null;
    if (!overlay) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomBy(event.deltaY > 0 ? 1.18 : 0.82);
    };
    overlay.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      overlay.removeEventListener('wheel', handleWheel);
    };
  }, [zoomBy]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleMouseMove = (event: MouseEvent) => {
      if (!isMouseDragging.current) return;
      const dx = event.clientX - mouseDragStart.current.x;
      const dy = event.clientY - mouseDragStart.current.y;
      setRegion({
        ...dragStartRegion.current,
        latitude: clampLatitude(dragStartRegion.current.latitude + (dy / mapSize.height) * dragStartRegion.current.latitudeDelta),
        longitude: dragStartRegion.current.longitude - (dx / mapSize.width) * dragStartRegion.current.longitudeDelta
      });
    };
    const stopMouseDrag = () => {
      isMouseDragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopMouseDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopMouseDrag);
    };
  }, [mapSize.height, mapSize.width]);

  const webMapHandlers = {
    onMouseDown: (event: React.MouseEvent) => {
      isMouseDragging.current = true;
      mouseDragStart.current = { x: event.clientX, y: event.clientY };
      dragStartRegion.current = regionRef.current;
    },
    onMouseUp: () => {
      isMouseDragging.current = false;
    }
  };

  const projection = getProjection(region);
  const tileOffsets = [-3, -2, -1, 0, 1, 2, 3];
  const centerTileXFloor = Math.floor(projection.centerTileX);
  const centerTileYFloor = Math.floor(projection.centerTileY);
  return (
    <View
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        setMapSize({ height: Math.max(1, height), width: Math.max(1, width) });
      }}
      style={[
        style,
        {
          backgroundColor: '#eef1ed',
          overflow: 'hidden'
        }
      ]}
    >
      {tileOffsets.flatMap((xOffset) =>
        tileOffsets.map((yOffset) => {
          const tileX = centerTileXFloor + xOffset;
          const tileY = centerTileYFloor + yOffset;
          const left = `${50 + (tileX - projection.centerTileX) * projection.tileWidthPercent}%` as DimensionValue;
          const top = `${50 + (tileY - projection.centerTileY) * projection.tileHeightPercent}%` as DimensionValue;
          return (
            <Image
              key={`${projection.zoom}-${tileX}-${tileY}`}
              source={{ uri: `https://tile.openstreetmap.org/${projection.zoom}/${wrapTileX(tileX, projection.zoom)}/${clampTileY(tileY, projection.zoom)}.png` }}
              style={{
                height: `${projection.tileHeightPercent}%` as DimensionValue,
                left,
                position: 'absolute',
                top,
                width: `${projection.tileWidthPercent}%` as DimensionValue
              }}
            />
          );
        })
      )}
      <View
        ref={mapOverlayRef}
        {...panResponder.panHandlers}
        {...(webMapHandlers as unknown as Record<string, unknown>)}
        style={{
          bottom: 0,
          cursor: 'grab' as never,
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
          zIndex: 2
        }}
      />
      <Text
        style={{
          backgroundColor: 'rgba(255,255,255,0.82)',
          borderRadius: 5,
          bottom: 8,
          color: 'rgba(56,80,109,0.68)',
          fontSize: 10,
          fontWeight: '700',
          left: 8,
          paddingHorizontal: 6,
          paddingVertical: 3,
          position: 'absolute',
          zIndex: 3
        }}
      >
        © OpenStreetMap contributors
      </Text>
      <View
        style={{
          gap: 8,
          position: 'absolute',
          right: 10,
          top: 10,
          zIndex: 5
        }}
      >
        <Pressable
          accessibilityLabel="Zoom in"
          onPress={() => zoomBy(0.55)}
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.94)',
            borderColor: 'rgba(56,80,109,0.16)',
            borderRadius: 8,
            borderWidth: 1,
            height: 34,
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 5,
            width: 34
          }}
        >
          <Text style={{ color: '#181716', fontSize: 20, fontWeight: '800', lineHeight: 22 }}>+</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Zoom out"
          onPress={() => zoomBy(1.8)}
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.94)',
            borderColor: 'rgba(56,80,109,0.16)',
            borderRadius: 8,
            borderWidth: 1,
            height: 34,
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 5,
            width: 34
          }}
        >
          <Text style={{ color: '#181716', fontSize: 22, fontWeight: '800', lineHeight: 22 }}>-</Text>
        </Pressable>
      </View>
      <MapRegionContext.Provider value={projection}>{children}</MapRegionContext.Provider>
    </View>
  );
}
