# Installation

Requires Node.js 24, npm and Python 3.

```sh
npm ci --ignore-scripts
npm ci --prefix backend --ignore-scripts
npm run check
npm run pages:build
python3 -m http.server --bind 127.0.0.1 --directory dist/pages 8080
```

Open http://127.0.0.1:8080/ for the project page and /demo/?demo=1 for the standalone demo.
For browser tests: `npx playwright install --with-deps chromium`, then `npm run test:browser`.
All test identities and photos are synthetic. Run `node scripts/screenshots.mjs` to
regenerate screenshots, then rebuild Pages.

A protected installation requires your own IServ OIDC and machine clients, confirmed
role IDs, class approvals, a private SQLite store and an isolated backend behind Apache.
The deployment directory contains an example Linux/systemd profile, not a universal
installer. Replace school.example endpoints in backend/auth.mjs, server.mjs, classes.mjs
and idm-token.mjs and adapt matching tests. Central multi-school endpoint configuration
is not yet implemented. Replace documentation IPs and local deployment paths.
Never deploy the full repository as a webroot: only public/ is intended for that purpose.
See INSTALLATION.md for the detailed checklist. No full installation on a second school
server or backup restore is claimed by this public release.
