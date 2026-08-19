import { useEffect, useState } from "react";
import { bridge } from "@/services";

/** ref → resolved data URI (null = resolution failed). Module-level so every
 *  thumbnail of the same image shares one bridge round-trip. */
const resolvedCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function resolveBlobRef(ref: string): Promise<string | null> {
  const cached = resolvedCache.get(ref);
  if (cached !== undefined) return Promise.resolve(cached);
  let promise = inflight.get(ref);
  if (promise === undefined) {
    promise = bridge
      .getBlobDataUri(ref)
      .catch(() => null)
      .then((uri) => {
        resolvedCache.set(ref, uri);
        inflight.delete(ref);
        return uri;
      });
    inflight.set(ref, promise);
  }
  return promise;
}

export function isBlobRef(src: string): boolean {
  return src.startsWith("blobref:");
}

/**
 * History replays carry engine blob references (`blobref:<mime>;<sha256>`)
 * instead of the original data URIs, which rendered as broken images. This
 * hook resolves them lazily through the extension: it returns `undefined`
 * while a blobref is being resolved (callers show their loading state) and
 * passes any other src through unchanged. On failure it falls back to the
 * original ref so the caller's broken-media state still shows.
 */
export function useResolvedMediaSrc(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    if (src === undefined || !isBlobRef(src)) return src;
    return resolvedCache.get(src) ?? undefined;
  });

  useEffect(() => {
    if (src === undefined || !isBlobRef(src)) {
      setResolved(src);
      return;
    }
    if (!resolvedCache.has(src)) setResolved(undefined);
    let cancelled = false;
    void resolveBlobRef(src).then((uri) => {
      if (!cancelled) setResolved(uri ?? src);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
