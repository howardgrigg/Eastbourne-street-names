#!/usr/bin/env node
// Downloads the street data from OpenStreetMap (via Overpass) into data/,
// so the game doesn't need to hit Overpass every time someone plays.
//
//   node scripts/fetch-streets.mjs            # all areas
//   node scripts/fetch-streets.mjs eastbourne # one area

import { writeFile, mkdir } from 'node:fs/promises';
import { AREAS, HIGHWAY_TYPES } from '../js/config.js';
import {
  fetchStreetsFromOverpass, overpassRequest, buildContextQuery, overpassToContext,
} from '../js/osm.js';

const USER_AGENT = 'eastbourne-street-names/1.0 (+https://github.com/howardgrigg/Eastbourne-street-names)';
const requestOptions = {
  // Overpass rejects requests that don't say who they are.
  headers: { 'User-Agent': USER_AGENT, Referer: 'https://github.com/howardgrigg/Eastbourne-street-names' },
  rounds: 4,
  retryDelayMs: 15000,
  log: console.log,
};
// Be polite to the shared Overpass servers between requests.
const pause = () => new Promise((r) => setTimeout(r, 5000));

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
    console.log(`${key}: downloading streets`);
    const streets = await fetchStreetsFromOverpass(area.bbox, HIGHWAY_TYPES, requestOptions);
    const out = { area: key, bbox: area.bbox, generated: new Date().toISOString(), streets };
    await writeFile(new URL(`streets-${key}.json`, dataDir), JSON.stringify(out));
    console.log(`${key}: ${streets.length} streets`);
  } catch (err) {
    console.error(`${key}: streets failed - ${err.message}`);
    failed = true;
  }
  await pause();
  try {
    console.log(`${key}: downloading background (coastline, buildings, paths)`);
    const json = await overpassRequest(buildContextQuery(area.bbox), requestOptions);
    const ctx = overpassToContext(json, area.bbox, HIGHWAY_TYPES);
    await writeFile(new URL(`context-${key}.json`, dataDir), JSON.stringify(ctx));
    console.log(`${key}: ${ctx.buildings.length} buildings, ${ctx.roads.length} other roads, ${ctx.paths.length} paths, ${ctx.coast.length} coastline pieces`);
  } catch (err) {
    console.error(`${key}: background failed - ${err.message}`);
    failed = true;
  }
  await pause();
}
process.exit(failed ? 1 : 0);
