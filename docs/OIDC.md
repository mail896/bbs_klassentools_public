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

Abgewiesene, erfolgreich von IServ identifizierte Schülerkonten werden ab
08.11.2026 für die administrative Nutzungsstatistik namentlich erfasst, sofern
sie keine Lehrkraftrolle haben. Keine APP-Sitzung; keine Tokens oder Callback-
Parameter im Protokoll. Einzelheiten, Umfang und Löschfrist: [USAGE.md](USAGE.md).

Voraussetzung für diese Statistik: IServ muss auch Schülerkonten für die
Identitätsübermittlung an den OIDC-Client zulassen. Unter Verwaltung → System →
Single-Sign-On → KlassenTools → Rechte darf daher keine ausschließliche
Teacher-Beschränkung stehen. Ein leeres Rechtefeld hebt diese vorgeschaltete
Rollen-/Gruppenbeschränkung auf; alternativ können die benötigten Rollen
Teacher und Student ausdrücklich zugelassen werden. Zusätzlich ist das
allgemeine IServ-Recht „OAuth verwenden“ erforderlich.
Die eigentliche APP-Berechtigung bleibt davon getrennt: ausschließlich bestätigte
Lehrkräfte erhalten eine Sitzung. Bestätigte Schüleridentitäten werden erfasst
und anschließend abgewiesen. IServ-Abbrüche ohne Identität bleiben namenlos.

Für die Betriebsdiagnose unterscheiden feste, nicht personenbezogene Meldungen im
Dienstjournal eine IServ-Ablehnung (`provider_access_denied`), eine fehlende
konfigurierte Schülerrolle (`configured_student_role_missing`) und eine fehlende
Statistikkonfiguration (`student_reporting_unconfigured`). Auch fehlende Logintransaktionen/State-Abweichungen und vorgelagerte OIDC-Fehler
werden durch feste bzw. explizit erlaubte Fehlercodes unterschieden. Maximal 20
Diagnosemeldungen pro Minute; sie enthalten weder Namen noch Claims,
Tokens, Callback-URLs oder frei übermittelte Fehlertexte. Eine vorgelagerte
Ablehnung ist kein Nachweis einer Schüleridentität und wird nicht als solche gezählt.
