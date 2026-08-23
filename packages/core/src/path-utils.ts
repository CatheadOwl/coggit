/**
 * Pure-JS path utilities — no Node.js dependency.
 * Replaces `node:path` in core for cross-platform compatibility.
 *
 * Implements only the subset of `node:path` used by core/mapping.ts.
 */

// ─── Path classifiers ───────────────────────────────────────────────────────

export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(p);
}

// ─── Component extraction ───────────────────────────────────────────────────

export function dirname(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return trimmed.slice(0, idx);
}

export function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}

// ─── Normalization ──────────────────────────────────────────────────────────

function normalizeParts(p: string): string[] {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else {
        parts.push('..');
      }
    } else {
      parts.push(seg);
    }
  }
  return parts;
}

export function normalize(p: string): string {
  const prefix = p.startsWith('/') ? '/' : /^[a-zA-Z]:[/\\]/.test(p) ? p.slice(0, 3) : '';
  return prefix + normalizeParts(p).join('/');
}

// ─── Resolve ────────────────────────────────────────────────────────────────

export function resolve(...segments: string[]): string {
  if (segments.length === 0) {
    return '.';
  }

  let resolved = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }

    resolved = resolved ? `${segment}/${resolved}` : segment;
    if (isAbsolute(segment)) {
      break;
    }
  }

  return normalize(resolved || '.');
}

// ─── Relative ───────────────────────────────────────────────────────────────

export function relative(from: string, to: string): string {
  const a = normalizeParts(from);
  const b = normalizeParts(to);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  const up = a.slice(i).map(() => '..');
  const down = b.slice(i);
  return up.concat(down).join('/') || '.';
}

// ─── Join ───────────────────────────────────────────────────────────────────

export function join(...segments: string[]): string {
  return normalize(segments.join('/'));
}

// ─── POSIX namespace (for cognition paths, always /-separated) ──────────────

export const posix = {
  isAbsolute(p: string): boolean { return p.startsWith('/'); },

  parse(p: string): { dir: string; name: string; ext: string } {
    const i = p.lastIndexOf('/');
    const dir = i < 0 ? '' : p.slice(0, i);
    const file = i < 0 ? p : p.slice(i + 1);
    const j = file.lastIndexOf('.');
    if (j <= 0) {
      return { dir, name: file, ext: '' };
    }
    return { dir, name: file.slice(0, j), ext: file.slice(j) };
  },

  join(...segments: string[]): string {
    return posix.normalize(segments.join('/'));
  },

  normalize(p: string): string {
    const parts: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') {
        continue;
      }
      if (seg === '..') {
        if (parts.length && parts[parts.length - 1] !== '..') {
          parts.pop();
        } else {
          parts.push('..');
        }
      } else {
        parts.push(seg);
      }
    }
    return (p.startsWith('/') ? '/' : '') + parts.join('/');
  },
};

// ─── Windows namespace (used only in isAbsoluteFsPath) ──────────────────────

export const win32 = {
  isAbsolute(p: string): boolean {
    return /^[a-zA-Z]:[/\\]/.test(p);
  },
};
