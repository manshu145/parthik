'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/feedback/states';

/**
 * Locale-scoped error boundary (master spec §25).
 *
 * Shows a retry action and the digest as a support reference, so a user can quote
 * something meaningful and we can correlate it with server logs. Error detail
 * itself is never rendered.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('states.error');
  const tCommon = useTranslations('common');

  useEffect(() => {
    // Client-side reporting endpoint. Cloud Monitoring does not provide
    // source-mapped browser stack traces (open item D-27a), so this is the
    // interim path and is deliberately best-effort.
    void fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        stack: error.stack?.slice(0, 4000),
        url: window.location.href,
      }),
      keepalive: true,
    }).catch(() => {
      // Reporting must never surface a second error to the user.
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
      <ErrorState
        title={t('title')}
        description={t('description')}
        action={<Button onClick={reset}>{tCommon('retry')}</Button>}
        {...(error.digest
          ? { reference: { label: t('referenceLabel'), value: error.digest } }
          : {})}
      />
    </main>
  );
}
