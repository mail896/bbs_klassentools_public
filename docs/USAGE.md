# Nutzungsstatistik

Administration → Nutzungsstatistik: 1/7/30/90 Tage, Aufrufe, Sitzungen,
Lehrkräfte, Klasse je Lehrkraft, Einzelauswahl/Teams, lokale Fotoimporte
(Anzahl) und serverseitige Speichervorgänge. Letzte 100 Aktivitäten ergänzen
Aggregationen. Keine rückwirkende Rekonstruktion aus Zugriffslogs.

GET /api/admin/usage prüft frisch Teacher und konfigurierte Admin-UUID.
POST /api/usage akzeptiert ausschließlich feste Ereignisse und minimale
Felder. Lehrkraft stammt aus der gültigen Sitzung, Klassen werden gegen
die bereits in dieser Sitzung bestätigte Klassenliste geprüft. Keine Übermittlung von
Schülernamen, Dateinamen, Fotos, Browserfingerprints oder Referer.
Origin-Prüfung, JSON, 1 KB, 600 Anfragen/min global und 60/min je Sitzung;
Ereignis-ID verhindert doppelte Speicherung. Anonyme Browserereignisse
können dennoch manipuliert werden oder fehlen: Statistik ist kein Audit.
Foto-Speichern/Löschen wird nach erfolgreicher Transaktion serverseitig
erfasst; das bestehende Fotoaudit bleibt unverändert maßgeblich.

Zusätzlicher zufälliger Secure/HttpOnly/SameSite-Lax-Cookie, nur /klassentools/,
30 Minuten Inaktivität (gemessen an erfassten Nutzungsereignissen).
Anmeldewechsel startet neue Statistik-Sitzung; mehrere Tabs teilen sie.
Keine Identifikation einzelner anonymer Personen; kein Wiedererkennen nach
Ablauf oder Dienstneustart. Zahlen für Zugang/Netz können sich überlappen.
Aufruf bedeutet einmal Laden der App, keine statischen Unteranfragen.

Neue separate SQLite-Datei neben photoDatabasePath: im Jail
/data/photos/usage.sqlite, Host /var/lib/klassentools-data/photos/usage.sqlite,
0600, vorhandenes geschütztes Datenverzeichnis. WAL und PBS wie bei Fotos.
Stündliche Löschung nach 90 Tagen, zusätzlich bei Abfrage/Aufzeichnung;
maximal 200.000 jüngste Ereignisse (somit ggf. kürzerer Zeitraum). Keine
Übertragung an Dritte. Die Frist betrifft aktive Statistikdaten, keine
bestehenden PBS-Sicherungen. Die Importoberfläche weist auf die Protokollierung von Änderungen hin. Die finale
Richtlinie bleibt unverändert; organisatorische Datenschutzbewertung wird
hierdurch nicht als durchgeführt behauptet.

Netzklassifikation: deployment/klassentools-apache.conf überschreibt
X-KlassenTools-Client-IP mit REMOTE_ADDR nach mod_remoteip. Vorhandene
Vertrauensgrenze: ausschließlich IServ-Proxy 192.0.2.10. Keine Auswertung
eines ungeprüften X-Forwarded-For im Backend. Nur bei
trustedUsageNetworkHeader=true UND schoolNetworks (IP/CIDR-Liste in
/etc/klassentools/config.json) erfolgt Schulnetz/außerhalb; sonst unbekannt.
IP wird nur im Arbeitsspeicher klassifiziert und NICHT in Statistik
persistiert. Das ändert keine vorhandenen allgemeinen Webserverlogs.
Die Liste muss alle schulischen Internet-Ausgänge einschließlich IPv6/VPN
entsprechend der gewünschten Zuordnung enthalten; keine Standortgarantie.

Veröffentlichung und Rückweg: [Installationshinweise](INSTALLATION.md).

## Bestätigte Schulnetze 26.09.2026
Marc bestätigte beide öffentlichen Ausgänge (192.0.2.84 und
198.51.100.210) sowie die vollständig lesbaren VLAN-Netze aus seiner
Netzliste. Versionsgebundene Konfigurationsquelle:
`deployment/school-networks.json`. Gast-WLAN zählt als Schulnetz.
Nicht vollständig sichtbare weitere Zeilen wurden nicht geraten.
Private LAN-Adressen und öffentliche NAT-Ausgänge werden gleichermaßen
berücksichtigt. Reale Log-Stichprobe enthielt private und andere öffentliche
Besucheradressen, keine reine Proxyadresse; keine Einzeladressen übernommen.
Historische Einträge mit unbekannter Herkunft bleiben unbekannt, da keine
IP-Adressen zur nachträglichen Zuordnung gespeichert sind.

## Administration als eigene Seite ab 0.6.1
Direkter Einstieg /klassentools/?admin=usage; weitere Bereiche admin=classes und
admin=audit. Normale Dokumentnavigation und Seitenscrollen, kein Dialog.
Bei fehlender Adminberechtigung wird nur der Anmeldehinweis angezeigt;
serverseitige Berechtigungen bleiben unverändert. Klassenfreigaben speichern
führt nicht mehr zurück in die Auswahl. Rücklink und Browsernavigation
warnen vor ungesicherten Änderungen. Adminseitenaufrufe zählen nicht als
Nutzung von KlassenTools.
