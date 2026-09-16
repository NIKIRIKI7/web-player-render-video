import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve, extname } from 'node:path';

export interface NormalizedMedia {
  type: 'local' | 'url';
  path: string;
  absolutePath?: string;
  extension: string;
  exists: boolean;
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);

function isUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getExtension(source: string): string {
  const ext = extname(source).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext) ? ext : '';
}

export function normalizeMediaPath(
  source: string,
  baseDir?: string,
): NormalizedMedia {
  if (isUrl(source)) {
    return {
      type: 'url',
      path: source,
      extension: getExtension(source),
      exists: true,
    };
  }

  const resolved = isAbsolute(source)
    ? source
    : baseDir
      ? resolve(baseDir, source)
      : resolve(source);

  const exists = existsSync(resolved);
  if (exists) {
    try {
      const st = statSync(resolved);
      if (!st.isFile()) {
        return {
          type: 'local',
          path: source,
          absolutePath: resolved,
          extension: getExtension(source),
          exists: false,
        };
      }
    } catch {
      return {
        type: 'local',
        path: source,
        absolutePath: resolved,
        extension: getExtension(source),
        exists: false,
      };
    }
  }

  return {
    type: 'local',
    path: source,
    absolutePath: resolved,
    extension: getExtension(source),
    exists,
  };
}

export function normalizeMediaPaths(
  sources: string[],
  baseDir?: string,
): NormalizedMedia[] {
  return sources.map((s) => normalizeMediaPath(s, baseDir));
}

export function assertMediaExists(
  source: string,
  baseDir?: string,
): NormalizedMedia {
  const normalized = normalizeMediaPath(source, baseDir);
  if (!normalized.exists) {
    const display = normalized.absolutePath ?? normalized.path;
    throw new Error(`Медиафайл не найден: ${display}`);
  }
  return normalized;
}

export function resolveMediaForFfmpeg(
  source: string,
  baseDir?: string,
): string {
  const normalized = normalizeMediaPath(source, baseDir);
  if (normalized.type === 'url') return normalized.path;
  if (!normalized.exists) {
    throw new Error(
      `Медиафайл не найден: ${normalized.absolutePath ?? normalized.path}`,
    );
  }
  return normalized.absolutePath ?? normalized.path;
}

export function createUniversalMediaResolver(baseDir?: string): {
  resolve(source: string): string;
  normalize(source: string): NormalizedMedia;
  assertExists(source: string): NormalizedMedia;
} {
  return {
    resolve: (source) => resolveMediaForFfmpeg(source, baseDir),
    normalize: (source) => normalizeMediaPath(source, baseDir),
    assertExists: (source) => assertMediaExists(source, baseDir),
  };
}
