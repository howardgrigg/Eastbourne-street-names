// Areas the game can be played on. Bounding boxes are [south, west, north, east].
// Pick one with ?area=<key> in the URL (or the dropdown in the header).
export const AREAS = {
  eastbourne: {
    label: 'Eastbourne (Days Bay to Burdan’s Gate)',
    bbox: [-41.322, 174.876, -41.278, 174.925],
  },
  bays: {
    label: 'Eastbourne + the Bays (from Point Howard)',
    bbox: [-41.322, 174.876, -41.2495, 174.925],
    // Seaview / Gracefield roads that clip the top of the box.
    exclude: [
      'Seaview Road', 'Wainuiomata Hill Road', 'Gracefield Road', 'Port Road',
      'Toop Street', 'Meachen Street', 'Marchbanks Street',
    ],
  },
};

export const DEFAULT_AREA = 'eastbourne';

// Which OSM highway types count as "streets" for the game.
export const HIGHWAY_TYPES = [
  'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'pedestrian', 'road',
];

// Backgrounds without any labels on them. Map tile services bake street names
// (or "data not available" notices) into their pictures, so "Map" is drawn
// entirely by the game from OpenStreetMap: sea, coastline, buildings and paths
// (see data/context-*.json).
const OSM_CREDIT = 'Streets &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const BASEMAPS = {
  map: {
    label: 'Map',
    drawContext: true,
    tiles: [],
    attribution: OSM_CREDIT,
  },
  satellite: {
    label: 'Satellite',
    drawContext: false,
    tiles: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxNativeZoom: 18, maxZoom: 19, attribution: `Imagery &copy; Esri, Maxar, Earthstar Geographics | ${OSM_CREDIT}` },
      },
    ],
  },
};

// How close (in screen pixels) a drop needs to be to a street to snap onto it.
export const SNAP_DISTANCE_MOUSE = 30;
export const SNAP_DISTANCE_TOUCH = 45;
