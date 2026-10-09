// The commit this Worker was deployed from, for the error record (issue #152).
// Stays null in git. The deploy-tools job in .github/workflows/deploy-pages.yml
// overwrites this file with the deploying commit just before `pages deploy`,
// because a direct-upload Pages project has no runtime variable that carries it
// (CF_PAGES_COMMIT_SHA exists only inside a Pages Git build).
export const BUILD_SHA = null;
