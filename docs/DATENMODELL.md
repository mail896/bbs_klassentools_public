# Datenmodell und Löschregeln

## Browser

`klassentools.theme.v1`: nur Darstellung. `klassentools.demo.v1`: Demo-Ziehungsverlauf
und Einstellungen. IServ-Namen, lokale Fotos und Sitzplanentwürfe bleiben im RAM;
keine Speicherung dieser Inhalte in LocalStorage. CSV/PNG/PDF sind ausdrückliche Downloads.

Secure/HttpOnly/SameSite=Lax-Cookies enthalten zufällige Sitzungskennungen.
Logintransaktionen und authentifizierte Sitzungen liegen ausschließlich im Backend-RAM;
Neustart beendet sie. Statistik-Sitzungen laufen nach 30 Minuten Inaktivität ab.

## Dauerhafte Daten, außerhalb Webroot und Releases

Host `/var/lib/klassentools-data`, im Dienst `/data`.
`classes.json`: Version 1 und freigegebene Gruppen-UUIDs; Hash als Schreibrevision.
`photos/photos.sqlite`: Schema user_version=1, additive Tabellenanlage beim Start:

| Tabelle | Inhalt |
| --- | --- |
| photo_classes | Klassenrevision |
| photos | Klassen-/Mitglieds-UUID, Bildversion, JPEG-BLOB |
| photo_audit | Zeit, Akteur, Klasse, Betroffener, Aktion, Versionen und Revision |
| seating_plans | Gemeinsamer Plan (leerer owner_id) bzw. private Version 1 pro Konten-UUID |
| seating_versions | Weitere persönliche Versionen pro Klasse, Eigentümer und Version |

Pläne enthalten Tischpositionen, Größe/Orientierung, Sitzplätze als Mitglieder-UUIDs,
Fixierungen und Lehrkraftposition. Anzeigenamen sind keine Zugriffsschlüssel.
Bis 50 aktive private Versionen pro Konto/Klasse. Gelöschte Planstände behalten
Versions-/Revisionsinformationen mit leerem Plan; Nummern werden nicht erneut vergeben.
Audit und Änderung werden gemeinsam bestätigt oder zurückgerollt.

`photos/usage.sqlite`: getrennte Ereignistabelle, nur definierte Aktionen,
Sitzung, optional Lehrkraft/Klasse, Anzahl und Netzklasse. Keine Fotos, Dateinamen,
Schülernamen, Roh-IP oder Browserfingerprints. Löschung nach 90 Tagen und Begrenzung
auf 200.000 jüngste Ereignisse. Statistik ist kein manipulationssicheres Audit.

Fotos ehemaliger Mitglieder werden nicht ausgeliefert, aber nicht automatisch gelöscht.
Einzel-/Klassenlöschung entfernt aktive Bilddaten; Audit bleibt bestehen.
Fachliche Aufbewahrungsfristen für Fotos/Audit und PBS-Sicherungen sind gesondert
festzulegen. Alte Releases löschen entfernt keine dieser Daten.

## Namen lernen

[Lernmodi, Betriebszuordnungen, Daten und Löschregeln](LEARNING.md). Fünf zusätzliche Tabellen in der bestehenden geschützten SQLite.
