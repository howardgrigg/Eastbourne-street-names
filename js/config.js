// Areas the game can be played on. Bounding boxes are [south, west, north, east].
// Pick one with ?area=<key> in the URL (or the dropdown in the header).
export const AREAS = {
  eastbourne: {
    label: 'Eastbourne (Days Bay to Burdan’s Gate)',
    bbox: [-41.322, 174.888, -41.278, 174.925],
  },
  bays: {
    label: 'Eastbourne + the Bays (from Point Howard)',
    bbox: [-41.322, 174.885, -41.243, 174.925],
  },
};

export const DEFAULT_AREA = 'eastbourne';

// Which OSM highway types count as "streets" for the game.
export const HIGHWAY_TYPES = [
  'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'pedestrian', 'road',
];

// Base maps without any labels on them.
export const BASEMAPS = {
  map: {
    label: 'Map',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    options: {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics | Streets &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
};

// How close (in screen pixels) a drop needs to be to a street to snap onto it.
export const SNAP_DISTANCE_MOUSE = 30;
export const SNAP_DISTANCE_TOUCH = 45;
