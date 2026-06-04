import type { JsonLd } from '@/lib/json-ld';

/**
 * Renders one or more schema.org nodes as a single
 * `<script type="application/ld+json">` block.
 *
 * Server component (no client JS shipped). The `ld+json` script type is NOT
 * executable, so it's exempt from the `script-src` CSP and needs no nonce.
 * `JSON.stringify` output is safe to inline here: every value originates from
 * our own typed builders / localized strings, not from user input. We still
 * escape `<` to avoid any chance of a `</script>` sequence breaking out of the
 * tag if a translated string ever contained one.
 */
export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // Inert `ld+json` (not executable); `<` is escaped above to prevent any
      // `</script>` breakout. Required to inline JSON-LD in the document.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
