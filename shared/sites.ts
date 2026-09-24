import { ORG_NAME } from './game.js';

export interface Site { id: string; name: string; detail: string; x: number; y: number; open: boolean }

/** Mainland bounding box in degrees — 73–135°E covers Xinjiang to the northeast coast, 18–53°N
 *  covers the southern coast to the Heilongjiang border. `project()` is the one place a real
 *  lon/lat becomes a map-panel percentage, so SITES below and the outline in site-map.ts (which
 *  projects its own lon/lat vertex list through this same function) can never independently
 *  drift apart — a city's dot is derived from the same mapping as the coastline it sits near. */
export const LON_RANGE: readonly [number, number] = [73, 135];
export const LAT_RANGE: readonly [number, number] = [18, 53];

/** Equirectangular-ish projection into percentages (0–100), resolution independent. Latitude
 *  runs opposite to SVG's y axis (north is a smaller y), hence the flip on the lat term. */
export function project(lon: number, lat: number) {
  return {
    x: (lon - LON_RANGE[0]) / (LON_RANGE[1] - LON_RANGE[0]) * 100,
    y: (LAT_RANGE[1] - lat) / (LAT_RANGE[1] - LAT_RANGE[0]) * 100,
  };
}

const site = (id: string, name: string, detail: string, lon: number, lat: number, open: boolean): Site =>
  ({ id, name, detail, open, ...project(lon, lat) });

export const SITES: Site[] = [
  site('beijing', '北京总部', '筹备中', 116.4, 39.9, false),
  site('shanghai', '上海办', `${ORG_NAME} · 1F`, 121.5, 31.2, true),
  site('guangzhou', '广州办', '筹备中', 113.3, 23.1, false),
];
