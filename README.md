# Tsunami watch

Election night 2026: is it a Democratic wave, a tsunami, or short of the polls? A static page (`index.html`) that
reads `data.json` every minute. The scoring rules live in `calc.js`, shared by the page and by `tools/apply.js`,
which merges each results sample into `data.json`. Results are sampled from major news outlets about every 15 minutes.
Unofficial.
