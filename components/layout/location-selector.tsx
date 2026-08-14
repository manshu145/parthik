'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/feedback/states';
import { useShell } from '@/components/providers/shell-provider';
import {
  checkServiceability,
  createSessionToken,
  fetchPlaceDetails,
  fetchSuggestions,
  getBrowserPosition,
  LocationRequestError,
  reverseGeocode,
  selectLocation,
  toSelectedLocation,
  type ServiceabilityResponse,
} from '@/lib/location/client';
import { formatPaise, paise } from '@/lib/money';
import type { PlaceSuggestion } from '@/lib/maps/types';
import { cn } from '@/lib/utils';

/**
 * Location selector (master spec §11, TASK 005).
 *
 * Three ways in, because each fails for real users in different ways:
 *
 *   1. Browser geolocation — fastest, but frequently denied or unavailable indoors.
 *   2. Address search (Places autocomplete) — needs a name the customer knows.
 *   3. Direct pincode entry — always works, and is the reliable fallback when the
 *      other two fail. It is deliberately visible rather than hidden behind them.
 *
 * SERVICEABILITY IS NEVER DECIDED HERE. Every path asks the server and renders what
 * comes back; this component cannot conclude that an address is deliverable.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'checking' }
  | { kind: 'result'; result: ServiceabilityResponse; label: string }
  | { kind: 'error'; message: string };

export function LocationTrigger({ className }: { className?: string }) {
  const t = useTranslations('location');
  const { location, openLocation } = useShell();

  const hasLocation = location.source !== 'none' && location.label.length > 0;

  return (
    <button
      type="button"
      onClick={openLocation}
      data-testid="location-trigger"
      className={cn(
        'flex min-h-[var(--size-tap-target)] items-center gap-2 rounded-[var(--radius-control)] px-2 text-left',
        'hover:bg-muted transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        className
      )}
    >
      <MapPin aria-hidden="true" className="text-primary size-5 shrink-0" />
      <span className="min-w-0">
        <span className="text-muted-foreground block text-[0.6875rem] leading-tight">
          {t('deliverTo')}
        </span>
        <span className="block truncate text-sm leading-tight font-medium">
          {hasLocation ? location.label : t('selectLocation')}
        </span>
      </span>
      <ChevronDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

export function LocationSheet() {
  const t = useTranslations('location');
  const tCommon = useTranslations('common');
  const { isLocationOpen, setLocationOpen } = useShell();

  return (
    <Sheet open={isLocationOpen} onOpenChange={setLocationOpen}>
      <SheetContent
        side="bottom"
        title={t('sheetTitle')}
        description={t('sheetDescription')}
        closeLabel={tCommon('close')}
        data-testid="location-sheet"
      >
        {/*
          The panel is a separate component so it MOUNTS FRESH each time the sheet
          opens (Radix unmounts closed content). That gives a new Places session
          token and a clean slate without a reset effect — resetting state from an
          effect would both trip react-hooks/set-state-in-effect and risk showing a
          previous attempt's error for one frame.
        */}
        <LocationPanel onDone={() => setLocationOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function LocationPanel({ onDone }: { onDone: () => void }) {
  const t = useTranslations('location');
  const tCommon = useTranslations('common');
  const { setLocation } = useShell();
  const router = useRouter();

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pincode, setPincode] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setSearching] = useState(false);

  /**
   * One Places session token for this entire opening — every keystroke and the
   * final details call. That is the billing contract: Google charges per session
   * rather than per keystroke when a token is supplied, so a token per keystroke
   * would multiply cost (docs/ARCHITECTURE.md §11.4).
   */
  const sessionTokenRef = useRef<string>(createSessionToken());

  /** Commits a resolved result: persists it, updates the shell, refreshes the tree. */
  const commit = useCallback(
    async (result: ServiceabilityResponse, label: string, source: 'detected' | 'manual') => {
      await selectLocation(result.pincode, label);
      setLocation(toSelectedLocation(result, source, label));

      // Server components read the location cookie, so the tree must re-render
      // for the new zone to take effect.
      router.refresh();
    },
    [router, setLocation]
  );

  const handleDetect = useCallback(async () => {
    setStatus({ kind: 'detecting' });

    try {
      const position = await getBrowserPosition();
      const { place, serviceability } = await reverseGeocode(position.latitude, position.longitude);

      if (!place || !serviceability) {
        // A coordinate that maps to no pincode is a normal outcome, not a failure —
        // ask for the pincode rather than dead-ending.
        setStatus({ kind: 'error', message: t('detectNoAddress') });
        return;
      }

      const label = place.components.city ?? serviceability.pincode;
      await commit(serviceability, label, 'detected');
      setStatus({ kind: 'result', result: serviceability, label });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof LocationRequestError && error.code === 'PERMISSION_DENIED'
            ? t('detectDenied')
            : t('detectFailed'),
      });
    }
  }, [commit, t]);

  /**
   * Debounced autocomplete.
   *
   * Every state update happens INSIDE the timer callback rather than in the effect
   * body — that keeps renders from cascading on each keystroke, and it also means a
   * short query does not flash a spinner before clearing.
   */
  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    // 300ms: long enough that a typed word is one billable request, short enough
    // to still feel responsive.
    const timer = setTimeout(() => {
      if (trimmed.length < 3) {
        setSuggestions([]);
        setSearching(false);
        return;
      }

      setSearching(true);

      void fetchSuggestions(trimmed, sessionTokenRef.current, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSuggestions(results);
        })
        .catch(() => {
          // A failed or superseded search must not replace the sheet with an
          // error — the pincode field still works.
          if (!controller.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleSuggestion = useCallback(
    async (suggestion: PlaceSuggestion) => {
      setStatus({ kind: 'checking' });
      setSuggestions([]);
      setQuery(suggestion.primaryText);

      try {
        const { place, serviceability } = await fetchPlaceDetails(
          suggestion.placeId,
          sessionTokenRef.current
        );

        if (!serviceability) {
          setStatus({ kind: 'error', message: t('noPincodeForAddress') });
          return;
        }

        const label = place.components.city ? suggestion.primaryText : serviceability.pincode;

        await commit(serviceability, label, 'manual');
        setStatus({ kind: 'result', result: serviceability, label });
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof LocationRequestError ? error.message : t('detectFailed'),
        });
      }
    },
    [commit, t]
  );

  const handlePincodeSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmed = pincode.trim();
      if (!/^[1-9][0-9]{5}$/.test(trimmed)) {
        setStatus({ kind: 'error', message: t('invalidPincode') });
        return;
      }

      setStatus({ kind: 'checking' });

      try {
        const result = await checkServiceability(trimmed);
        const label = result.zone?.city ?? result.pincode;
        await commit(result, label, 'manual');
        setStatus({ kind: 'result', result, label });
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof LocationRequestError ? error.message : t('detectFailed'),
        });
      }
    },
    [commit, pincode, t]
  );

  const isBusy = status.kind === 'detecting' || status.kind === 'checking';

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        block
        onClick={() => void handleDetect()}
        disabled={isBusy}
        data-testid="location-detect"
      >
        {status.kind === 'detecting' ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Navigation aria-hidden="true" />
        )}
        {status.kind === 'detecting' ? t('detecting') : t('detectLocation')}
      </Button>

      {/* ---- Address search ---- */}
      <div className="flex flex-col gap-2">
        <label htmlFor="location-search" className="text-sm font-medium">
          {t('searchLabel')}
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            id="location-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            className="pl-9"
            data-testid="location-search"
            aria-describedby="location-search-hint"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
              }}
              aria-label={tCommon('clear')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        <p id="location-search-hint" className="text-muted-foreground text-xs">
          {t('searchHint')}
        </p>

        {isSearching && (
          <p role="status" className="text-muted-foreground text-xs">
            {t('searching')}
          </p>
        )}

        {suggestions.length > 0 && (
          <ul className="border-border divide-border divide-y rounded-[var(--radius-control)] border">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId}>
                <button
                  type="button"
                  onClick={() => void handleSuggestion(suggestion)}
                  disabled={isBusy}
                  className={cn(
                    'hover:bg-muted flex min-h-[var(--size-tap-target)] w-full flex-col items-start px-3 py-2 text-left',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]'
                  )}
                  data-testid="location-suggestion"
                >
                  <span className="text-sm font-medium">{suggestion.primaryText}</span>
                  <span className="text-muted-foreground text-xs">{suggestion.secondaryText}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Pincode entry: the always-works fallback ---- */}
      <form onSubmit={(event) => void handlePincodeSubmit(event)} className="flex flex-col gap-2">
        <label htmlFor="location-pincode" className="text-sm font-medium">
          {t('pincodeLabel')}
        </label>
        <div className="flex gap-2">
          <Input
            id="location-pincode"
            value={pincode}
            onChange={(event) =>
              // Digits only, max six: an invalid value cannot be submitted at all,
              // rather than being validated after the fact.
              setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            // `inputMode` gives mobile a numeric keypad without `type="number"`,
            // which would add spinners and permit exponent characters.
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder={t('pincodePlaceholder')}
            aria-invalid={status.kind === 'error' ? true : undefined}
            data-testid="location-pincode"
          />
          <Button type="submit" disabled={isBusy || pincode.length !== 6}>
            {status.kind === 'checking' ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {tCommon('check')}
          </Button>
        </div>
      </form>

      {/* ---- Outcome ---- */}
      {status.kind === 'error' && (
        <ErrorState title={t('errorTitle')} description={status.message} />
      )}

      {status.kind === 'result' && (
        <ServiceabilityOutcome result={status.result} label={status.label} onDone={onDone} />
      )}
    </div>
  );
}

/**
 * The result panel.
 *
 * States the terms — fee, free-delivery threshold, minimum order, ETA — at the
 * moment of choosing, so delivery cost is never a surprise at checkout.
 */
function ServiceabilityOutcome({
  result,
  label,
  onDone,
}: {
  result: ServiceabilityResponse;
  label: string;
  onDone: () => void;
}) {
  const t = useTranslations('location');
  const tCommon = useTranslations('common');

  if (!result.isServiceable) {
    return (
      <div
        role="status"
        data-testid="location-unserviceable"
        className="border-border rounded-[var(--radius-control)] border p-3"
      >
        <p className="text-sm font-medium">
          {t('unserviceableTitle', { pincode: result.pincode })}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">{t('unserviceableDescription')}</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="location-serviceable"
      className="border-border rounded-[var(--radius-control)] border p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Check aria-hidden="true" className="text-success size-4" />
        {t('serviceableTitle', { label })}
      </p>

      <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
        {result.baseDeliveryFeePaise !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('deliveryFee')}</dt>
            <dd>{formatPaise(paise(result.baseDeliveryFeePaise))}</dd>
          </div>
        )}
        {result.freeDeliveryThresholdPaise !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('freeDeliveryAbove')}</dt>
            <dd>{formatPaise(paise(result.freeDeliveryThresholdPaise))}</dd>
          </div>
        )}
        {result.minOrderPaise !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('minOrder')}</dt>
            <dd>{formatPaise(paise(result.minOrderPaise))}</dd>
          </div>
        )}
        {result.etaMinutes !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('estimatedDelivery')}</dt>
            <dd>{t('minutes', { count: result.etaMinutes })}</dd>
          </div>
        )}
      </dl>

      <Button variant="primary" block className="mt-3" onClick={onDone}>
        {tCommon('continue')}
      </Button>
    </div>
  );
}
