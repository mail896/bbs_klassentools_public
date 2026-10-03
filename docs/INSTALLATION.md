# Installation

## Öffentliche Demo lokal

Node.js 24.x, npm und Python 3 werden benötigt. Alle Bibliotheken sind lokal;
Browseroberfläche ohne Framework oder Build-Abhängigkeit zur Laufzeit.

```sh
npm ci --ignore-scripts
npm ci --prefix backend --ignore-scripts
npm run pages:build
python3 -m http.server --bind 127.0.0.1 --directory dist/pages 8080
```

http://127.0.0.1:8080/ zeigt die Projektseite, /demo/?demo=1 die statische Demo.
IServ und persistente Klassenfunktionen sind dort absichtlich nicht aktiviert.

## Qualität und Browser

```sh
npm run check
npx playwright install --with-deps chromium
npm run test:browser
```

Browserprogramme verwenden synthetische Klassen/Fotos und gemocktes IServ.
Foto-/Sitzplanintegration startet ein lokales Backend mit temporärer Datenbank.
`node scripts/screenshots.mjs` erzeugt nach `npm run pages:build` die Demo-Screenshots
und prüft die statische Demo ohne API-Zugriffe. Danach Pages erneut bauen.

## Eigene geschützte Installation

Die Vorlagen in deployment sind ein administratives Linux-/Apache-/systemd-Profil,
kein fertiger Universalinstaller. Dokumentationsnetze und school.example sind Platzhalter.
Insbesondere folgende Werte müssen zum eigenen IServ passen:

- Issuer/Callback in backend/auth.mjs, Anwendungs-Origin in backend/server.mjs.
- IDM-Origin in backend/classes.mjs und Tokenendpunkt in backend/idm-token.mjs.
- Bestätigte Rollen- und Administrator-UUIDs, Client-ID und Speicherpfade in config.example.json.
- Vertrauenswürdiger Proxy, Schulnetze, Hosts, Unix-Socket und freigegebene Dienstpfade.

Diese Endpunktkonstanten sind noch kein zentral konfigurierbares Mehrschulprofil.
Tests müssen gemeinsam mit geänderten Endpunkten angepasst werden. Nicht ungeprüft
auf einem fremden Server aktivieren; eine vollständige Frischsysteminstallation
bei einer anderen Schule ist mit dieser Veröffentlichung nicht nachgewiesen.

Secrets gehören außerhalb Git/Webroot in geschützte Dateien/systemd Credentials.
Die Backenddatenbank muss außerhalb des Webroots liegen. OIDC-Clients und Maschinenclient
separat registrieren. Nur Teacher-Rolle plus Mitgliedschaft und freigegebene Klasse
berechtigt zum Zugriff. Private Pläne zusätzlich nur für ihren Eigentümer.

Nur public/ öffentlich ausliefern. Backend über Unix-Socket/Apache anbinden.
Daten, Konfiguration und Veröffentlichungshelfer nicht im Webroot ablegen.
Die Paketierer lesen benannte Git-Tags; Deployments sind administrative Schritte.
