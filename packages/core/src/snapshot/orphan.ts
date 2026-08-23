/**
 * @deprecated Scan-backed orphan detection was retired.
 *
 * Orphans are registry-backed maintenance diagnostics in core/maintenance.ts.
 * Cognition-root scans now detect stray/unregistered cognition only.
 */
export { detectStrayCognitionEntries } from '../maintenance';
