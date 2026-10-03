# Architektur

Browser → Apache HTTPS `/klassentools/` → Unix-Socket → Node-Dienst → IServ / private SQLite-Dateien.

## Browser

`public/index.html` ist die gemeinsame Dokumentstruktur. `style.css` enthält
Darstellung, responsive Regeln, Themes und Druckansicht. `app.js` verbindet
Anwendungszustand, Ereignisse und API-Aufrufe. Kleine Module haben feste Grenzen:

| Modul | Aufgabe |
| --- | --- |
| logic.mjs | Mischen, Ziehen, Teamgrößen, Wahrscheinlichkeit |
| demo.mjs | Fiktive Namen und stabile Porträtindizes, frische Datensätze beim Zurücksetzen |
| photo-matching.mjs | Reiner Dateinamenabgleich ohne Netzwerk und ohne Bildanalyse |
| seating-layout.mjs | Tischgeometrie und Projektion zur Lehrkraftperspektive |
| seating-export.mjs | Lokales Canvas aus einem unveränderlichen Ansichtsschnappschuss |
| learning-core.mjs | Gemeinsame Lernregeln für Browser und Server |
| learning-ui.mjs | Lernrunden und Betriebszuordnungen |
| admin-ui.mjs | Verwaltungsansichten, Filter und Seitennavigation |

Die URL wählt die Ansicht: ohne Zusatz Landingpage, `?app=1` Arbeitsoberfläche,
`?demo=1` Demo; `?admin=classes`, `?admin=audit`, `?admin=usage`,
`?admin=companies` und `?admin=learning` wählen Verwaltungsansichten.
`app`/`demo` sind Anwesenheitsschalter, keine IDs; ihre Werte werden nicht ausgewertet.
`login=ok/denied/failed` wird nach Anzeige durch die passende Ansichts-URL ersetzt.
Keiner dieser Parameter verleiht Rechte.

## Backend

`server.mjs`: HTTP-Routing, Sitzungen, CSRF, aktuelle Klassenrechte, begrenzte Bodies.
`auth.mjs`: OIDC; `idm-token.mjs`: serverseitiger Maschinentoken-Cache;
`classes.mjs`: begrenzter REST-Adapter und Rollenfilter;
`catalog.mjs`: revisionsgeschützte atomare Klassenfreigabe;
`photos.mjs`: Bilddecoder und gemeinsame SQLite-Transaktionen für Fotos, Pläne, Audit;
`seating-validation.mjs`: erlaubtes Planformat und Mitgliederprüfung;
`errors.mjs`: erwartete HTTP-Fehler; `usage.mjs`: getrennte Statistik/Netzklassifikation.

Alle geschützten Endpunkte nutzen dieselbe fehlschließende Sessionerneuerung.
Vor und nach IServ-Antwort wird Ablauf/Abmeldung geprüft. Foto-/Planrechte werden
vor Speicherung nochmals bestätigt. Gemeinsame Transaktionen bleiben bewusst in
`photos.mjs`: Audit und Änderung dürfen nicht auseinanderfallen.

## Grenzen

Kein Service Worker, keine Hintergrundabfrage der Klassen im Browser, keine
externen Frontend-Skripte oder Schriften. Klassenlisten werden pro geöffneter Seite
im Speicher wiederverwendet; geschützte Serveranfragen prüfen Rechte trotzdem neu.
Einzelner Node-Prozess, lokale SQLite-Datenbanken, kein Mehrinstanzbetrieb.

## Namen lernen

[Lernmodi, Betriebszuordnungen, Daten und Löschregeln](LEARNING.md). Fünf zusätzliche Tabellen in der bestehenden geschützten SQLite.
