#!/usr/bin/env node
// Downloads the street data from OpenStreetMap (via Overpass) into data/,
// so the game doesn't need to hit Overpass every time someone plays.
//
//   node scripts/fetch-streets.mjs            # all areas
//   node scripts/fetch-streets.mjs eastbourne # one area

import { writeFile, mkdir } from 'node:fs/promises';
import { AREAS, HIGHWAY_TYPES } from '../js/config.js';
import { fetchStreetsFromOverpass } from '../js/osm.js';

const dataDir = new URL('../data/', import.meta.url);
await mkdir(dataDir, { recursive: true });

const keys = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(AREAS);
let failed = false;
for (const key of keys) {
  const area = AREAS[key];
  if (!area) {
    console.error(`Unknown area "${key}". Known: ${Object.keys(AREAS).join(', ')}`);
    failed = true;
    continue;
  }
  try {
    const streets = await fetchStreetsFromOverpass(area.bbox, HIGHWAY_TYPES);
    const out = { area: key, bbox: area.bbox, generated: new Date().toISOString(), streets };
    await writeFile(new URL(`streets-${key}.json`, dataDir), JSON.stringify(out));
    console.log(`${key}: ${streets.length} streets`);
  } catch (err) {
    console.error(`${key}: failed - ${err.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
