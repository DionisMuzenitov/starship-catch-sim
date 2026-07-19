// Shared site constants for the docs build — imported by both the VitePress
// config and the report-sync script so the repo/demo URLs live in one place.

export const REPO_URL = "https://github.com/DionisMuzenitov/starship-catch-sim";
/** The deployed app (GitHub Pages project site). */
export const APP_URL = "https://dionismuzenitov.github.io/starship-catch-sim/";
/** The deployed docs site, nested under the app base. */
export const DOCS_URL = `${APP_URL}docs/`;
/** Base for linking to a file on `main` in the repo. */
export const GH_BLOB_MAIN = `${REPO_URL}/blob/main/`;
