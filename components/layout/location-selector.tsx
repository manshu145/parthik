'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown, MapPin, Navigation } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/feedback/states';
import { useShell } from '@/components/providers/shell-provider';
import { cn } from '@/lib/utils';

/**
 * Location selector — SHELL ONLY.
 *
 * Location is a core feature (master spec §11), but detection, Google Places
 * autocomplete, geocoding, pincode serviceability and saved addresses all belong
 * to TASK 005. This provides the trigger and the panel so the header is complete
 * and the interaction is testable; the panel itself states plainly that selection
 * is not wired up yet rather than offering a control that silently does nothing.
 */

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
        <div className="flex flex-col gap-4">
          {/* Disabled rather than absent: it shows what the finished flow will
              offer, without pretending to work. Enabled in TASK 005. */}
          <Button variant="outline" block disabled>
            <Navigation aria-hidden="true" />
            {t('detectLocation')}
          </Button>

          <EmptyState title={t('notConfiguredTitle')} description={t('notConfiguredDescription')} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
