export const KNOWN_REASONING_KEYS = [
  'reasoning_content',
  'reasoning_details',
  'reasoning',
] as const;

export type ReasoningKey = (typeof KNOWN_REASONING_KEYS)[number];

export const DEFAULT_REASONING_KEY: ReasoningKey = KNOWN_REASONING_KEYS[0];

export function extractReasoningStrings(source: unknown): { key: string; value: string }[] {
  if (typeof source !== 'object' || source === null) return [];
  const record = source as Record<string, unknown>;
  const found: { key: string; value: string }[] = [];
  for (const key of KNOWN_REASONING_KEYS) {
    const value = record[key];
    if (typeof value === 'string') found.push({ key, value });
  }
  return found;
}

export function extractReasoning(
  source: unknown,
  explicitKey?: string,
): { key: string; value: string } | undefined {
  if (explicitKey !== undefined) {
    if (typeof source !== 'object' || source === null) return undefined;
    const value = (source as Record<string, unknown>)[explicitKey];
    return typeof value === 'string' ? { key: explicitKey, value } : undefined;
  }
  return extractReasoningStrings(source)[0];
}

export class ReasoningKeyDialect {
  private _detected: string | undefined;

  constructor(private readonly _explicitKey?: string) {}

  observe(source: unknown): string | undefined {
    const found = extractReasoning(source, this._explicitKey);
    if (found === undefined) return undefined;
    if (this._explicitKey === undefined && this._detected === undefined) {
      this._detected = found.key;
    }
    return found.value;
  }

  observeAll(source: unknown): { key: string; value: string }[] {
    if (this._explicitKey !== undefined) {
      const found = extractReasoning(source, this._explicitKey);
      return found === undefined ? [] : [found];
    }
    const found = extractReasoningStrings(source);
    const first = found[0];
    if (first !== undefined && this._detected === undefined) {
      this._detected = first.key;
    }
    return found;
  }

  outboundKey(): string {
    return this._explicitKey ?? this._detected ?? DEFAULT_REASONING_KEY;
  }
}
