import { createHash } from 'node:crypto';

/**
 * T-Bank (Tinkoff) e-acquiring Token signing.
 *
 * Verified against the public T-Bank developer docs (developer.tbank.ru/eacq):
 *   1. take only ROOT-LEVEL SCALAR fields (string / number / boolean) — EXCLUDE
 *      the `Token` field itself and any nested object/array values (Receipt /
 *      DATA / Items …);
 *   2. add a field `Password` whose value is the merchant terminal password;
 *   3. sort all (key, value) pairs alphabetically by KEY ascending;
 *   4. concatenate ONLY THE VALUES (not the keys) into one string;
 *   5. SHA-256 of the UTF-8 bytes, hex LOWERCASE — that is the Token.
 *
 * The SAME algorithm is used to VERIFY an incoming webhook: drop the `Token`
 * field, drop nested Receipt/Data, add Password, sort, concat values, SHA-256.
 *
 * Implementation notes:
 *   - Booleans serialise as JavaScript's String(true) / String(false) — i.e.
 *     `"true"` / `"false"` lowercased, matching the JSON shape T-Bank sends in
 *     the `Success` field of webhooks. The webhook payload is parsed by Express
 *     so `Success` arrives as a real boolean; we serialise it back the SAME way
 *     the gateway hashed it.
 *   - Numbers serialise as `String(n)` — `Number(42)` → `"42"`, `Number(0)` →
 *     `"0"`. Floats are passed through verbatim; we never pass floats here
 *     because Amount is always kopecks INTEGER.
 *   - `null` / `undefined` fields are dropped (T-Bank does not sign absent
 *     fields). An empty-string value IS still signed (the field is present).
 */

/** A scalar field T-Bank will sign. Nested objects/arrays are deliberately skipped. */
export type TbankScalar = string | number | boolean;

/** A T-Bank request/notification payload. Nested fields are dropped at sign time. */
export type TbankPayload = Record<string, unknown>;

/**
 * Compute the T-Bank Token for a payload + merchant password.
 *
 * Pure, deterministic, no side effects — safe to call from a request hot path
 * and from spec fixtures. Throws nothing: an empty payload returns the SHA-256
 * of the password alone (an edge case the docs allow).
 */
export function signTbankToken(payload: TbankPayload, password: string): string {
  // Step 1: take only ROOT-LEVEL SCALAR fields, dropping `Token` + nested.
  const scalars: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'Token') {
      continue;
    }
    if (!isScalar(value)) {
      // Nested objects / arrays / null / undefined are NOT signed.
      continue;
    }
    scalars.push([key, scalarToString(value)]);
  }

  // Step 2: add the Password field.
  scalars.push(['Password', password]);

  // Step 3: sort by KEY ascending (UTF-16 code-unit order, which matches the
  // T-Bank docs' ASCII-alphabetical sort for the field names they use).
  scalars.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  // Step 4: concatenate ONLY the values (not the keys).
  const joined = scalars.map(([, v]) => v).join('');

  // Step 5: SHA-256 of the UTF-8 bytes, hex LOWERCASE.
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}

/**
 * Verify a T-Bank webhook token. Returns true iff the recomputed Token matches
 * what the gateway sent (case-insensitive comparison — T-Bank docs say hex
 * lowercase, but be lenient on the verify side).
 *
 * Convenience over signTbankToken; the heavy lifting is the SAME algorithm.
 */
export function verifyTbankToken(payload: TbankPayload, password: string): boolean {
  const provided = payload.Token;
  if (typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const expected = signTbankToken(payload, password);
  return constantTimeEqualHex(provided, expected);
}

/** Whether `value` is a root-level scalar T-Bank will include in the token base. */
function isScalar(value: unknown): value is TbankScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Serialise a scalar the way the T-Bank gateway hashes it. */
function scalarToString(value: TbankScalar): string {
  if (typeof value === 'boolean') {
    // The webhook's `Success` is a JSON boolean → `"true"` / `"false"`.
    return value ? 'true' : 'false';
  }
  // Numbers + strings serialise via String() — integers verbatim, no exp form.
  return String(value);
}

/**
 * Constant-time hex-string comparison. Returns false on length mismatch (which
 * itself is a length-leaking signal, but the two sides are SHA-256 hex so the
 * length is always 64; any other length is malformed input and we reject).
 * Case-insensitive so `Abc` matches `abc`.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < al.length; i += 1) {
    diff |= al.charCodeAt(i) ^ bl.charCodeAt(i);
  }
  return diff === 0;
}
