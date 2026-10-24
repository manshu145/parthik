/**
 * Renders a JSON-LD block.
 *
 * `JSON.stringify` output is escaped for `</script>` before injection. Structured
 * data is built from database content, so a product name containing `</script>`
 * would otherwise break out of the tag — the classic JSON-LD XSS vector.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      // Safe: the only dynamic content is the escaped JSON above.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
