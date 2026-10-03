# Sitzplan: Ansicht und Ausgabe

Beim Öffnen startet der Sitzplan in der Detailansicht. Die linke Bedienleiste fasst
„Plan & Speichern“ und „Tische & Anordnung“ in zunächst geschlossenen Gruppen
zusammen. „Zufällig verteilen“ bleibt direkt erreichbar.

„Gesamtansicht“ zeigt den vollständigen Raum proportional innerhalb der verfügbaren Fensterfläche. Die Anzeige reagiert auf Fenstergröße und Vollbild; bei langen Räumen werden Namen entsprechend kleiner. „Detailansicht“ zeigt größere Tische zum Bearbeiten, bei Bedarf mit Scrollen. Beide Ansichten verwenden dieselben gespeicherten Positionen.

„Drucken“ öffnet nach Vorbereitung die Browser-Druckfunktion. Der Plan ist für eine A4-Seite eingerichtet, Hoch- oder Querformat passend zur Raumform. Im Druckdialog kann auch PDF gewählt werden. Eigene Drucker-/Browsereinstellungen (Papierformat, Ränder, Kopf-/Fußzeilen, Skalierung) können die Ausgabe beeinflussen. Bei direktem Browserdruck vor Fertigstellung der Druckansicht weist die Seite auf den eigenen Druckbutton hin.

„Als Bild speichern“ lädt eine PNG-Datei herunter, bis zu 4096 Pixel an der längsten Seite. Fotos, Namen, Klasse, Planname, Tafel und Lehrkraft bleiben enthalten; UI-Bedienelemente entfallen. Fixierte/abwesende Schüler sind gekennzeichnet, Schüler ohne Platz stehen unter dem Plan. Exportiert wird der aktuelle sichtbare Entwurf, nicht automatisch der zuletzt gespeicherte Stand. Ein Export speichert keine Planänderungen auf dem Server.

Beide Ausgaben entstehen ausschließlich im Browser aus den bereits berechtigt geladenen Daten. Es gibt keinen Exportserver, keine zusätzliche Datenübertragung und keine externe Bibliothek. Der Hintergrund ist für lesbaren Druck unabhängig vom Dunkelmodus hell. Bildladefehler werden mit einem Hinweis und Initialen statt Foto behandelt. PNG-Dateien und ausgedruckte Pläne enthalten die ausgewählten Namen/Fotos.

## Tischorientierung
Neue Tische erhalten über „Ausrichtung neuer Tische“ Querformat oder Hochkant.
Der Drehknopf am Tisch wechselt die Ausrichtung; Schüler und Fixierungen bleiben erhalten.
Die Mitte bleibt möglichst gleich, am oberen/linken Raumrand wird begrenzt.
Bei engen individuellen Anordnungen den Tisch gegebenenfalls anschließend verschieben.
Die Orientierung gehört zum gespeicherten Plan und wird auch beim Export verwendet.

## Automatische Raumvergrößerung
Tische oder Lehrkraft über den bisherigen Rand ziehen: Die Zeichenfläche wächst
in die gewünschte Richtung. Auch die Pfeiltasten können den Raum erweitern.
Während der Mausbewegung bleiben Maßstab und die übrigen Tischpositionen am
Bildschirm stabil. Erst nach dem Loslassen wird die Gesamtansicht eingepasst.
Die erweiterte Fläche wird zusammen mit dem Plan gespeichert. Abgebrochene
Zeigerbewegungen werden zurückgenommen; maximale Koordinaten bleiben begrenzt.
