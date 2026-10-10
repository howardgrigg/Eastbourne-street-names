# Eastbourne Street Names

A little web game for anyone who has lived in Eastbourne, New Zealand: the map has
had every street name removed, and you have to put them back.

- The street names are listed alphabetically beside (or, on a phone, under) the map.
- **Drag** a name onto a street and it snaps into place along the street.
  On a phone, **tap** a name and then **tap** the street.
- Drag a placed name onto another street to swap them, or back to the list to remove it.
- Hit **Submit** to get your score. Then you can reveal the answers, retry just the
  ones you got wrong, or share your score.
- Progress is saved in your browser, so you can come back to it.
- Switch between a plain map and satellite imagery (neither has labels), and between
  Eastbourne proper and Eastbourne + the Bays (Point Howard to Days Bay).

Street data comes from [OpenStreetMap](https://www.openstreetmap.org/) via the Overpass API.
The background map is Esri's label-free "World Light Gray Base".

## Playing / hosting it

It's a static site with no build step.

**GitHub Pages (easiest):** in the repo's *Settings → Pages*, set *Source* to
**GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) downloads
fresh street data from OpenStreetMap, then publishes the site on every push (and once a
month to pick up map changes). Send your friends the Pages URL.

**Locally:**

```sh
node scripts/fetch-streets.mjs   # optional: saves data/streets-*.json (needs Node 18+)
npx serve .                      # then open http://localhost:3000
```

If `data/streets-<area>.json` isn't there, the game fetches the streets live from
Overpass in the browser instead, which works but is a bit slower.

## Tweaking

Everything adjustable lives in `js/config.js`:

- `AREAS` – the bounding boxes (`[south, west, north, east]`) of each playable area.
  Add your own and pick it with `?area=<key>` or the dropdown.
- `HIGHWAY_TYPES` – which kinds of OSM roads count as streets.
- `BASEMAPS` – the label-free background maps.
- `SNAP_DISTANCE_*` – how close to a street a drop has to be to snap onto it.

After changing an area, re-run `node scripts/fetch-streets.mjs` (or just push and let
the workflow do it).

## Credits

Map data © OpenStreetMap contributors (ODbL). Base map and imagery © Esri.
Built with [Leaflet](https://leafletjs.com/) (vendored in `vendor/leaflet`).
