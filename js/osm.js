// Shared between the browser game and scripts/fetch-streets.mjs.
// Turns OpenStreetMap data from the Overpass API into a list of named streets.

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function buildQuery(bbox, highwayTypes) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];
way["highway"~"^(${highwayTypes.join('|')})$"]["name"](${s},${w},${n},${e});
out geom;`;
}

const round = (v) => Math.round(v * 1e6) / 1e6;

// Liang-Barsky: the part of segment a-b inside the box, or null.
function clipSegment(a, b, [s, w, n, e]) {
  const [y0, x0] = a;
  const dy = b[0] - y0;
  const dx = b[1] - x0;
  let t0 = 0;
  let t1 = 1;
  const checks = [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  const at = (t) => [round(y0 + dy * t), round(x0 + dx * t)];
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}

// Keep only the parts of a way inside the bounding box, so long roads
// like Marine Drive don't stretch out of the area being played.
function clipLine(points, bbox) {
  const lines = [];
  let cur = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegment(points[i], points[i + 1], bbox);
    if (!seg) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length) cur.push(seg[0]);
    cur.push(seg[1]);
    if (seg[1] !== points[i + 1]) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

export function overpassToStreets(json, bbox) {
  const byName = new Map();
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry || !el.tags || !el.tags.name) continue;
    const name = el.tags.name.trim();
    const points = el.geometry.filter(Boolean).map((p) => [round(p.lat), round(p.lon)]);
    const lines = clipLine(points, bbox);
    if (!lines.length) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(...lines);
  }
  return [...byName]
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// POST a query to the Overpass servers in turn, retrying in rounds.
export async function overpassRequest(query, options = {}) {
  const { fetchImpl = fetch, headers = {}, rounds = 1, retryDelayMs = 0, log = () => {}, accept = () => true } = options;
  const errors = [];
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      log(`  waiting ${Math.round((retryDelayMs * round) / 1000)}s before retrying`);
      await new Promise((r) => setTimeout(r, retryDelayMs * round));
    }
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`responded ${res.status} ${res.statusText}`.trim());
        const json = await res.json();
        if (!accept(json)) throw new Error('returned no usable data');
        return json;
      } catch (err) {
        const msg = `${url}: ${err.message}`;
        log(`  ${msg}`);
        errors.push(msg);
      }
    }
  }
  throw new Error(`all Overpass servers failed (${errors.join('; ')})`);
}

export async function fetchStreetsFromOverpass(bbox, highwayTypes, options = {}) {
  let streets;
  await overpassRequest(buildQuery(bbox, highwayTypes), {
    ...options,
    accept: (json) => (streets = overpassToStreets(json, bbox)).length > 0,
  });
  return streets;
}

// ---------- Background ("context") map ----------
// Everything that helps people find their way without giving names away:
// the coastline, buildings, and roads/paths that aren't part of the game.

export function buildContextQuery(bbox) {
  const b = bbox.join(',');
  return `[out:json][timeout:120];
(
  way["natural"="coastline"](${b});
  way["highway"](${b});
  way["building"](${b});
  way["natural"="water"](${b});
);
out geom;`;
}

const PATH_TYPES = new Set(['footway', 'path', 'steps', 'track', 'bridleway', 'cycleway', 'pedestrian']);
const round5 = (v) => Math.round(v * 1e5) / 1e5;

export function overpassToContext(json, bbox, highwayTypes) {
  const gameTypes = new Set(highwayTypes);
  const ctx = { coast: [], roads: [], paths: [], buildings: [], water: [] };
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const pts = el.geometry.filter(Boolean).map((p) => [round5(p.lat), round5(p.lon)]);
    if (pts.length < 2) continue;
    const t = el.tags;
    if (t.building) {
      if (pts.some((p) => inBox(p, bbox))) ctx.buildings.push(pts);
    } else if (t.natural === 'water') {
      ctx.water.push(pts);
    } else if (t.natural === 'coastline') {
      ctx.coast.push(...clipLine(pts, bbox));
    } else if (t.highway) {
      if (gameTypes.has(t.highway) && t.name) continue; // drawn by the game itself
      const target = PATH_TYPES.has(t.highway) ? ctx.paths : ctx.roads;
      target.push(...clipLine(pts, bbox));
    }
  }
  return ctx;
}

function inBox([lat, lon], [s, w, n, e]) {
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

// ---------- Sea from coastline ----------
// OSM coastlines run with the land on the left and the sea on the right.
// Join the clipped pieces into chains, then close each chain off along the
// edge of the box (walking clockwise, which keeps the sea on the right) to
// get sea polygons. Closed rings are islands.
export function buildSea(coastPieces, bbox) {
  const [s, w, n, e] = bbox;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  // Join pieces end-to-start into chains.
  const pieces = coastPieces.map((p) => p.slice());
  const chains = [];
  while (pieces.length) {
    let chain = pieces.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (same(chain[chain.length - 1], p[0])) { chain = chain.concat(p.slice(1)); }
        else if (same(p[p.length - 1], chain[0])) { chain = p.concat(chain.slice(1)); }
        else continue;
        pieces.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(chain);
  }

  const eps = 1e-5;
  // Position around the box, clockwise from the north-west corner: 0..4.
  const perim = ([lat, lon]) => {
    if (Math.abs(lat - n) < eps) return (lon - w) / (e - w);
    if (Math.abs(lon - e) < eps) return 1 + (n - lat) / (n - s);
    if (Math.abs(lat - s) < eps) return 2 + (e - lon) / (e - w);
    if (Math.abs(lon - w) < eps) return 3 + (lat - s) / (n - s);
    return null;
  };
  const corners = [[n, w], [n, e], [s, e], [s, w]]; // at t = 0(4), 1, 2, 3

  const islands = [];
  const open = [];
  for (const c of chains) {
    if (c.length > 2 && same(c[0], c[c.length - 1])) { islands.push(c); continue; }
    const t0 = perim(c[0]);
    const t1 = perim(c[c.length - 1]);
    if (t0 === null || t1 === null) continue; // dangling piece, can't close it
    open.push({ pts: c, t0, t1 });
  }

  const sea = [];
  const unused = new Set(open);
  while (unused.size) {
    const first = unused.values().next().value;
    unused.delete(first);
    const ring = first.pts.slice();
    let cur = first;
    for (let guard = 0; guard <= open.length; guard++) {
      // Next chain start met walking clockwise from where this one ends.
      let next = null;
      let bestDelta = Infinity;
      for (const c of [first, ...unused]) {
        let delta = (c.t0 - cur.t1 + 4) % 4;
        if (delta < 1e-9 && c === cur) delta = 4;
        if (delta < bestDelta) { bestDelta = delta; next = c; }
      }
      for (let k = Math.floor(cur.t1) + 1; k <= cur.t1 + bestDelta; k++) ring.push(corners[k % 4]);
      if (next === first) break;
      ring.push(...next.pts);
      unused.delete(next);
      cur = next;
    }
    sea.push(ring);
  }
  return { sea, islands };
}
