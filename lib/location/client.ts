import type { PlaceSuggestion, ResolvedPlace } from '@/lib/maps/types';
import type { SelectedLocation } from '@/lib/shell/types';

/**
 * Browser-side client for the location API.
 *
 * Every call goes to our own routes, never to Google directly — the Maps key is a
 * server key and must not reach the browser (docs/SECURITY.md). This module is the
 * only place the location endpoints are called from, so the request shapes stay
 * consistent.
 */

export interface ServiceabilityResponse {
  isServiceable: boolean;
  pincode: string;
  zone: { id: string; code: string; name: string; city: string; state: string } | null;
  baseDeliveryFeePaise: number | null;
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number | null;
  etaMinutes: number | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Thrown for any non-success response, carrying the SERVER's public message so the
 * UI shows the real reason ("we don't deliver there yet", "service unavailable")
 * rather than a generic failure string.
 */
export class LocationRequestError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'LocationRequestError';
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null;

  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Fall through to the generic error below.
  }

  if (!response.ok || !body?.success || body.data === undefined) {
    throw new LocationRequestError(
      body?.error?.message ?? 'Something went wrong. Please try again.',
      body?.error?.code ?? 'UNKNOWN'
    );
  }

  return body.data;
}

/**
 * Creates a Places session token.
 *
 * One token must cover an entire typing session and the final details lookup —
 * that is how Google bills autocomplete per session instead of per keystroke. A new
 * token per keystroke would silently multiply cost, so callers generate one when
 * the sheet opens and reuse it until a place is selected.
 *
 * `crypto.randomUUID` requires a secure context; the fallback keeps development
 * over plain http working.
 */
export function createSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export async function checkServiceability(
  pincode: string,
  signal?: AbortSignal
): Promise<ServiceabilityResponse> {
  const response = await fetch(
    `/api/v1/location/serviceability?pincode=${encodeURIComponent(pincode)}`,
    { signal: signal ?? null }
  );
  return unwrap<ServiceabilityResponse>(response);
}

export async function fetchSuggestions(
  query: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, sessionToken });
  const response = await fetch(`/api/v1/location/autocomplete?${params.toString()}`, {
    signal: signal ?? null,
  });
  const data = await unwrap<{ suggestions: PlaceSuggestion[] }>(response);
  return data.suggestions;
}

export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<{ place: ResolvedPlace; serviceability: ServiceabilityResponse | null }> {
  const params = new URLSearchParams({ placeId, sessionToken });
  const response = await fetch(`/api/v1/location/place-details?${params.toString()}`, {
    signal: signal ?? null,
  });
  return unwrap<{ place: ResolvedPlace; serviceability: ServiceabilityResponse | null }>(response);
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<{ place: ResolvedPlace | null; serviceability: ServiceabilityResponse | null }> {
  const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
  const response = await fetch(`/api/v1/location/reverse-geocode?${params.toString()}`, {
    signal: signal ?? null,
  });
  return unwrap<{ place: ResolvedPlace | null; serviceability: ServiceabilityResponse | null }>(
    response
  );
}

/** Persists the choice server-side (sets the location cookie). */
export async function selectLocation(
  pincode: string,
  label?: string
): Promise<ServiceabilityResponse> {
  const response = await fetch('/api/v1/location/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label ? { pincode, label } : { pincode }),
  });
  return unwrap<ServiceabilityResponse>(response);
}

/**
 * Maps a server serviceability result to the shell's display shape.
 *
 * Kept here so `isServiceable` always originates from the server response and is
 * never inferred in a component.
 */
export function toSelectedLocation(
  result: ServiceabilityResponse,
  source: SelectedLocation['source'],
  label?: string
): SelectedLocation {
  return {
    label: label ?? result.zone?.city ?? result.pincode,
    pincode: result.pincode,
    city: result.zone?.city ?? null,
    zoneId: result.zone?.id ?? null,
    isServiceable: result.isServiceable,
    source,
  };
}

/**
 * Reads the browser's current position.
 *
 * Wrapped in a promise with an explicit timeout because the Geolocation callback
 * API can otherwise hang indefinitely when a user neither grants nor denies the
 * prompt, leaving a spinner running forever.
 */
export function getBrowserPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationRequestError('Location detection is not available.', 'UNSUPPORTED'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => {
        const code =
          error.code === error.PERMISSION_DENIED
            ? 'PERMISSION_DENIED'
            : error.code === error.TIMEOUT
              ? 'TIMEOUT'
              : 'POSITION_UNAVAILABLE';
        reject(new LocationRequestError(error.message || 'Could not detect location.', code));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}
