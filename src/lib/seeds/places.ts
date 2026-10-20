import { DEFAULT_PLACES_LOCATION, DEFAULT_PLACES_RADIUS } from "@/lib/agent/config";
import { ENV_PLACES_LOCATION, ENV_PLACES_RADIUS } from "./constants";
import type { PlacesLocation } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

/** Thrown for a malformed places env var. Fixing the env is the only remedy, so it is not swallowed. */
export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConfigError";
  }
}

const LAT_LON = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** The places search location from env, falling back to the default city. Radius is miles, above 0 and at most 100. */
export function placesLocation(env: Env = process.env): PlacesLocation {
  const rawLoc = env[ENV_PLACES_LOCATION]?.trim() || DEFAULT_PLACES_LOCATION;
  const m = LAT_LON.exec(rawLoc);
  if (!m) throw new SeedConfigError(`${ENV_PLACES_LOCATION} must look like "40.7128,-74.0060" (lat,lon)`);
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new SeedConfigError(`${ENV_PLACES_LOCATION} is out of range`);

  const rawRadius = env[ENV_PLACES_RADIUS]?.trim();
  const radius = rawRadius ? Number(rawRadius) : DEFAULT_PLACES_RADIUS;
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) throw new SeedConfigError(`${ENV_PLACES_RADIUS} must be above 0 and at most 100 (miles)`);

  return { location: `${lat},${lon}`, radius };
}
