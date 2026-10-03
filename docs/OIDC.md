# IServ-Anmeldung

Beispiel für den selbst zu registrierenden Client KlassenTools. Start `https://apps.school.example/klassentools/`,
Callback exakt `https://apps.school.example/klassentools/oidc/callback`.
Issuer `https://school.example`; Discovery liefert Endpunkte für Token/JWKS/UserInfo.

Vertraulicher Client: Authorization Code + PKCE S256, state und nonce.
ClientSecretPost; RS256-Prüfung einschließlich Issuer, Audience und Subject.
Scopes ausschließlich `openid profile iserv:uuid iserv:roles iserv:groups`.
Kein Refresh-Token, keine Passwörter in der App, keine Browser-Access-Tokens.

Teacher-/Student-Rollen werden anhand bestätigter UUIDs geprüft, nicht anhand des
Namens. Personenidentität kommt aus verifizierten UUID-Claims; widersprüchliche
Kennungen werden abgewiesen. Adminberechtigung ist eine zusätzliche Konten-UUID-Liste.

Transaktionen 5 Minuten, Sitzungen höchstens 1 Stunde und nie länger als Tokens.
Sessionabfragen erneuern UserInfo bei Bedarf nach 60 Sekunden; geschützte Klassen-,
Foto-, Plan- und Adminzugriffe prüfen frisch. Dies ist kein periodisches Browser-Polling.
Abmeldung beendet nur die App-Sitzung. Dienstneustart beendet alle App-Sitzungen.

Schülerkonten/fehlende Berechtigung erhalten eine deutliche Meldung auf der Landingpage.
Fehlgeschlagene Anmeldung wird nicht automatisch erneut gestartet.

## Separater IDM-Zugriff

Ein zweiter Maschinenclient mit `client_credentials` und ausschließlich
`iserv:idm:api-read` liest Gruppen/Mitglieder über `https://idm.school.example`.
Vorlage `deployment/idm-client.example.json`; Freigabe/Anlage erfolgen auf IServ.
Maschinentokens bleiben im Backend, werden bis kurz vor Ablauf wiederverwendet;
parallele Erneuerungen teilen eine Anfrage. Sie ersetzen keine Benutzerberechtigung.

Secrets in root-only Dateien, über systemd Credentials eingebunden. Secretwerte
nicht in Git, Browser, Kommandozeile, Dokumentation oder Logs übernehmen.
