/** Parse a pipe-delimited source line into key/value fields. */
export function parseSourceFields(line, prefix) {
  return Object.fromEntries(line.slice(prefix.length).split('|').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
}

/** Parse four non-negative coordinates from a comma-delimited bounding box. */
export function parseBoundingBox(value) {
  const parts = String(value || '').split(',').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isFinite(part) && part >= 0) ? parts : null;
}
