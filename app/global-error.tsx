'use client';

/**
 * Last-resort error boundary.
 *
 * Replaces the root layout when rendering fails above the locale layout, so it
 * must render its own <html>/<body> and cannot rely on translations — the i18n
 * provider may be exactly what failed. Copy is therefore intentionally hardcoded
 * in English; this is the one screen where that is correct.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '1.5rem',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#555', fontSize: '0.875rem', marginBottom: '1rem' }}>
            We could not load Parthik. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 1rem',
              borderRadius: 8,
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ color: '#777', fontSize: '0.75rem', marginTop: '1rem' }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
