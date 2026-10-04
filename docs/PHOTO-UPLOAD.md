# Fotozuordnung

Aktuelle Bedienung, Speicherung und Löschung: [PHOTOS-OPERATIONS.md](PHOTOS-OPERATIONS.md).

`public/photo-matching.mjs` vergleicht Dateinamen mit der bereits berechtigt geladenen
Klassenliste. Beide Namensreihenfolgen, Komma/Punkt/Leerzeichen/Unterstrich/Bindestrich
und Groß-/Kleinschreibung werden normalisiert. Exakte eindeutige Treffer werden
vorausgewählt. Namensgleichheit und mehrere Dateien für dieselbe Person bleiben offen.

Umlautumschrift und kleine Tippfehler liefern höchstens fünf Vorschläge, die bestätigt
werden müssen. Editierdistanz höchstens drei und höchstens 20 % der Namenslänge ist
eine Heuristik, keine Wahrscheinlichkeit. Es gibt keine Gesichtserkennung.

Erst „Fotos dauerhaft speichern“ überträgt bestätigte Zuordnungen. Dateinamen werden
nicht als Serverpfade verwendet. Lokale TEMP-Fotos bleiben im Browser. Der Abgleich
ersetzt weder serverseitige Berechtigungsprüfung noch Bildvalidierung.

### Foto und Betrieb gemeinsam bearbeiten

Unter „Klasse & Fotos“ öffnet „Anpassen“ den Dialog „Foto & Betrieb“ für die gewählte Person. Die vorhandene Betriebszuordnung ist vorausgewählt; die Suche filtert nach Name, Ort oder Kurzbezeichnung. „Kein Betrieb zugeordnet“ entfernt die Zuordnung. Die Bildausschnittregler lassen sich bei Bedarf aufklappen.

„Änderungen speichern“ speichert nur geänderte Angaben, schließt den Dialog und bestätigt grün. Eine reine Betriebsänderung schreibt das Foto nicht erneut. Neue Fotos können nach der Personenzuordnung ebenfalls einzeln mit Betrieb gespeichert werden; weitere Fotos bleiben zur Prüfung offen. Bei einem Teilerfolg bleibt der Dialog offen und zeigt, was bereits gespeichert wurde. Die bestehende Sammelzuordnung bleibt verfügbar.

Im Dialog „Klasse & Fotos“ stehen Fotoauswahl und gespeicherte Fotos oben. Die Sammelzuordnung der Ausbildungsbetriebe folgt darunter. Beim Anpassen eines einzelnen Fotos kann der Betrieb direkt mit zugeordnet werden.


## Zuordnungen prüfen und Fotos entfernen

Importierte Fotos bleiben auch nach manueller Zuordnung sichtbar. Die grüne Zeile nennt
die Person und kennzeichnet die noch ausstehende Speicherung. „Nur offene Zuordnungen“
ist ein optionaler Filter; sind alle Fotos zugeordnet, führt „Alle anzeigen“ zurück zur
vollständigen Kontrolle. Erst Speichern übernimmt neue Fotos dauerhaft.
Gespeicherte Fotos lassen sich auch im Anpassen-Dialog über „Foto entfernen“ nach
Bestätigung löschen. Der Schüler erhält das Standardbild; die Betriebszuordnung bleibt.
Hintergrundklick, Escape und Abbrechen schließen Fotodialoge mit Rückfrage bei
ungespeicherten Änderungen. Während einer Speicherung ist manuelles Schließen gesperrt.
