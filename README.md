# ♞ Schachkakh

Online-Schach mit Elo-Ranglisten, Matchmaking, KI-Gegnern, Taktik-Training, 4-Spieler-Schach, Skins und Battlepass.

## Starten

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen. Port per `PORT=…` änderbar.

## Speicher (wichtig für Render)

Ohne Einstellungen speichert der Server in `data/db.json`. **Auf Render wird diese Datei bei jedem Neustart gelöscht** – Accounts und Logins wären weg.
Deshalb Supabase verwenden (gleiches Prinzip wie die Rangliste der Spielesammlung):

1. In Render beim Dienst *schachkakh* unter **Environment** setzen:
   - `SUPABASE_URL` – z. B. `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_KEY` – der `service_role`-Schlüssel
2. Die Tabelle `rangliste_speicher` muss existieren. Wenn die Rangliste schon Supabase nutzt, ist sie da; sonst `supabase_setup.sql` im Supabase-SQL-Editor ausführen.

Schachkakh legt seine Daten als eigene Zeile `id = 'schachkakh'` ab und berührt die Rangliste nicht.
Optional: `SUPABASE_TABLE` und `SUPABASE_ROW` für andere Namen. Prüfen: `GET /api/health` zeigt `"storage":"supabase"`.

Logins halten ein Jahr (gleitend – wer spielt, bleibt angemeldet). Wenn der Server gerade aufwacht, wartet die Seite, statt abzumelden.

## Features

| Bereich | Was drin ist |
|---|---|
| **Wertungen** | Getrennte Elo für Bullet, Blitz, Schnellschach, 4 Spieler und Taktik; Ranglisten je Wertung |
| **Online** | Matchmaking (1+0, 2+1, 3+0, 3+2, 5+0, 10+0, 15+10), Server-Uhren, Vorzüge (Premoves), Remis, Zurücknahme auf Anfrage, Revanche mit Farbtausch, Abbrechen in den ersten Zügen, Chat, Wiederverbinden |
| **Freunde** | Freundesliste mit Online-Status, direkte Herausforderung (gewertet/ungewertet), Zuschauen, Profile anderer Spieler |
| **Zuschauen** | Liste aller Live-Partien (2 und 4 Spieler) |
| **Partie-Analyse** | Bewertungsbalken, Genauigkeit in %, Einstufung jedes Zuges (Bester Zug … Patzer), bester Zug als Pfeil; alte Partien aus dem Profil nachspielen |
| **Brett** | Pfeile und Markierungen per Rechtsklick, Zug-Animation, geschlagene Figuren + Materialvorteil, Eröffnungsnamen, Tastatur (←/→/F), PGN kopieren/herunterladen |
| **Computer** | 6 Gegner von 400 bis 2200 Elo, Tipps und Zugrücknahme |
| **Taktik** | 300 geprüfte Matt-Aufgaben (Matt in 1/2/3) mit eigener Wertung, tägliches Rätsel (+25 Münzen), Puzzle Rush (3 Minuten, 3 Leben) |
| **4-Spieler-Schach** | Jeder gegen jeden auf dem 14×14-Kreuzbrett, Punkte fürs Schlagen, +20 fürs Mattsetzen; gewertet online (leere Plätze nach 15 s mit Bots), gegen 3 Bots oder im privaten Raum mit Freunden |
| **Einstellungen** | Sound, Koordinaten, Animation, Hervorhebung, Premoves, Auto-Dame, Aufgeben bestätigen |
| **Skins & Battlepass** | 10 Bretter, 8 Figurensets, 30-stufiger Pass mit Gratis- und Premium-Spur |
| **Arena-Turniere** | Jede halbe Stunde (UTC :00 Blitz 3+0, :30 Bullet 1+0): automatische Paarungen, Sieg 2 / Remis 1, ab 2 Siegen in Folge doppelt 🔥, Preise 300/150/75 Münzen (nur mit Punkten, unter 4 Spielern halbiert) |
| **Tagesaufgaben** | 3 Aufgaben pro Tag, +50 Münzen wenn alle erledigt; Login-Bonus 10–70 Münzen je nach Serie |
| **Erfolge** | 25 Erfolge mit Münz-Belohnungen, im Profil sichtbar |
| **Emotes** | 8 schnelle Reaktionen in Online- und 4-Spieler-Partien (abschaltbar) |

Belohnungen, Käufe und Wertungen werden **auf dem Server** berechnet.

## 4-Spieler-Regeln (vereinfacht nach Chess.com „Free for all“)

- Reihenfolge Rot → Blau → Gelb → Grün
- Punkte: Bauer 1, Springer 3, Läufer 5, Turm 5, Dame 9 (umgewandelte Dame 1)
- Schachmatt: +20 und der Gegner scheidet aus; Patt: +20 für den Pattgesetzten
- Ausgeschiedene Figuren werden grau, bringen 0 Punkte und geben kein Schach
- Bauern werden auf der 8. Reihe (Brettmitte) zur Dame; Rochade ja, en passant nein
- Ende, wenn nur noch einer übrig ist, zwei übrig sind und einer mehr als 20 Punkte vorne liegt, oder nach 50 Runden ohne Schlagen. Platzierung nach Punkten.

## Aufbau

```
server/index.js      HTTP-API + statische Dateien
server/online.js     WebSocket: Matchmaking, Räume, Herausforderungen, Zuschauen, 2P- und 4P-Partien, Bots
server/progress.js   Shop, Battlepass, Elo (auch Mehrspieler-Elo)
server/db.js         Speicher: Supabase oder data/db.json
server/events.js     Tagesaufgaben, Login-Bonus, Erfolge
server/tournaments.js Arena-Turniere (Planung, Paarung, Wertung, Preise)
shared/catalog.js    Wertungen, Bedenkzeiten, Skins, Battlepass, Elo-Formel
shared/fourchess.js  Regel-Engine + Bot für 4-Spieler-Schach
shared/puzzles.js    Taktik-Aufgaben (erzeugt mit npm run puzzles)
shared/openings.js   Eröffnungsnamen
public/              Oberfläche: app.js, board.js, fourview.js, ai-worker.js, pieces.js
test/                Unit-Tests (npm test)
```

## Entwicklung

- `ARENA_DEMO_MINUTES=2 npm start` legt sofort eine kurze Test-Arena an (startet nach 10 Sekunden).
