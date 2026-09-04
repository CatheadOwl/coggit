export default {
  profile: 'coggit-headless',
  // The eval temp workspace is not a git repository, so the doc-link gate
  // fails with a git error as blocking and splices feedback steps that
  // exhaust the script — this package's cases test the plugin surface, not
  // gate interaction, so the gates row is disabled by default (a
  // gate-interaction case can restore it per-case with disableRows: []).
  disableRows: ['gates'],
}
