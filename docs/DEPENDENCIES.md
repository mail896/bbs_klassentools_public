# Laufzeit und Abhängigkeiten

Backend Node 24.21.0, npm-Lock v3, Installation mit npm ci --ignore-scripts.
openid-client 6.8.8 (MIT), OAuth/JWT-Abhängigkeiten siehe backend/package-lock.json.
sharp 0.35.4 (Apache-2.0) für serverseitige Bilddekodierung/Neukodierung.
Vorbereitete @img-Binärpakete aus npm, Integrität durch Lockdatei. libvips 8.18.6
(LGPL-2.1-or-later), weitere mitgelieferte Bibliotheken/Lizenzen in den Paketen.
Keine native Kompilierung oder npm-Lifecycle-Skripte im Releaseprozess.
Node-eigenes node:sqlite, keine zusätzliche Datenbankserverinstallation.

Bei Updates Lockdatei, Lizenzen, Sicherheitsmeldungen, native Runtime-Kompatibilität
und Foto-/OIDC-Tests prüfen.

## Entwicklungswerkzeuge

Root-package-lock.json: ESLint 10.11.0 und @eslint/js 10.0.1 (MIT),
Prettier 3.9.9 (MIT), globals 17.12.0 (MIT), PostCSS 8.5.28 (MIT).
Ausschließlich lokal für Syntax-/Unbenutztprüfung, Formatierung und CSS-Konsolidierung;
kein Paket davon wird mit dem Frontend oder Backend veröffentlicht.
Playwright 1.63.0 (Apache-2.0) ist als lokale Entwicklungsabhängigkeit fest gepinnt. Chromium wird mit npx playwright install bereitgestellt.

npm audit am 03.10.2026: 0 gemeldete Schwachstellen sowohl in Backend-Laufzeit-
als auch in Entwicklungsabhängigkeiten. Momentaufnahme, keine dauerhafte Garantie.
