// Pure slug helpers for group URLs (schema comment: "for pretty URLs"). No
// I/O — group.ts (the DB-backed service) appends a random suffix and
// retries on collision.

const MAX_BASE_LENGTH = 40;

// Lowercases, strips anything that isn't alphanumeric, collapses runs of
// separators into a single hyphen. A group named "" or "!!!" collapses to
// "" — the caller always appends a random suffix, so an empty base still
// yields a valid, non-empty slug.
export function slugifyGroupName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH);
}
