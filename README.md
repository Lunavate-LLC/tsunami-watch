# Tsunami watch

Election night 2026: is it a Democratic wave, a tsunami, or short of the polls? A static page (`index.html`) that
reads `data.json` every minute. The scoring rules live in `calc.js`, shared by the page and by `tools/apply.js`,
which merges each results sample into `data.json`. Vote counts and calls come from NBC News feeds, sampled about every 7 minutes by tools/fetch_nbc.js.
Unofficial.
