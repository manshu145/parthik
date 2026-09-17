'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type AvailabilityValue = 'OFFLINE' | 'ONLINE' | 'ON_BREAK' | 'ON_DELIVERY';

interface AvailabilitySettingsProps {
  initialAvailability: AvailabilityValue;
  locale: 'en' | 'hi';
}

const OPTIONS: Array<Exclude<AvailabilityValue, 'ON_DELIVERY'>> = ['ONLINE', 'ON_BREAK', 'OFFLINE'];

export function AvailabilitySettings({
  initialAvailability,
  locale,
}: AvailabilitySettingsProps) {
  const [availability, setAvailability] = useState<AvailabilityValue>(initialAvailability);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locked = availability === 'ON_DELIVERY';

  async function updateAvailability(next: Exclude<AvailabilityValue, 'ON_DELIVERY'>) {
    if (busy || locked || next === availability) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/v1/driver/availability', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability: next }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        data?: { availability?: AvailabilityValue };
        error?: { message?: string };
      };

      if (!response.ok || !payload.success) {
        setMessage(
          payload.error?.message ??
            (locale === 'hi' ? 'स्थिति अपडेट नहीं हो सकी।' : 'Availability could not be updated.')
        );
        return;
      }

      setAvailability(payload.data?.availability ?? next);
      setMessage(locale === 'hi' ? 'स्थिति अपडेट हो गई।' : 'Availability updated.');
    } catch {
      setMessage(locale === 'hi' ? 'स्थिति अपडेट नहीं हो सकी।' : 'Availability could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="driver-availability-settings">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {locale === 'hi' ? 'काम की स्थिति' : 'Work availability'}
          </CardTitle>
          <Badge variant={availabilityVariant(availability)}>{availability.replaceAll('_', ' ')}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          {locked
            ? locale === 'hi'
              ? 'सक्रिय डिलीवरी के दौरान उपलब्धता अपने-आप नियंत्रित होती है। डिलीवरी पूरी होने के बाद इसे बदलें।'
              : 'Availability is controlled automatically during an active delivery. Change it after the delivery is completed.'
            : locale === 'hi'
              ? 'ऑफर पाने के लिए ऑनलाइन रहें, थोड़ी देर के लिए ब्रेक चुनें, या दिन खत्म होने पर ऑफलाइन जाएँ।'
              : 'Stay online to receive offers, take a break temporarily, or go offline when you finish for the day.'}
        </p>

        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={availability === option ? 'primary' : 'secondary'}
              disabled={busy || locked || availability === option}
              onClick={() => void updateAvailability(option)}
            >
              {availabilityLabel(option, locale)}
            </Button>
          ))}
        </div>

        {message && (
          <p className="text-muted-foreground text-sm" role="status">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function availabilityVariant(value: AvailabilityValue) {
  if (value === 'ONLINE') return 'success' as const;
  if (value === 'ON_DELIVERY') return 'primary' as const;
  if (value === 'ON_BREAK') return 'warning' as const;
  return 'neutral' as const;
}

function availabilityLabel(
  value: Exclude<AvailabilityValue, 'ON_DELIVERY'>,
  locale: 'en' | 'hi'
) {
  if (locale === 'hi') {
    if (value === 'ONLINE') return 'ऑनलाइन';
    if (value === 'ON_BREAK') return 'ब्रेक';
    return 'ऑफलाइन';
  }

  if (value === 'ONLINE') return 'Online';
  if (value === 'ON_BREAK') return 'On break';
  return 'Offline';
}
