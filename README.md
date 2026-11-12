# ♞ Schachkakh

Online-Schach mit Elo-Rangliste, Matchmaking, KI-Gegnern, Skins und Battlepass.

## Starten

```bash
npm install
npm start
```

Dann im Browser <http://localhost:3000> öffnen. Port per `PORT=…` änderbar, Speicherort per `DATA_DIR=…` (Standard: `./data`).

Zum Testen von Online-Partien einfach zwei Browserfenster (eins davon privat/inkognito) öffnen und mit zwei Accounts „Gegner suchen“ klicken.

## Features

| Bereich | Was drin ist |
|---|---|
| **Accounts** | Registrierung/Login, Passwörter mit scrypt gehasht |
| **Online gewertet** | Matchmaking nach Elo (Suchfenster wächst mit Wartezeit), Bedenkzeiten 1+0, 3+2, 5+0, 10+0, serverseitige Uhren, Remisangebot, Aufgabe, Chat, Wiederverbinden (30 s Schonfrist) |
| **Elo** | Startwert 1200, K=40 für die ersten 30 Partien, dann K=20 (K=10 ab 2400), Ränge Bronze → Großmeister, Rangliste |
| **Privater Raum** | Raum-Code an Freunde schicken, ungewertet |
| **KI-Gegner** | 4 Stufen (Anfänger → Großmeister), Alpha-Beta-Suche mit Ruhesuche im Web Worker |
| **Lokal** | Zwei Spieler an einem Gerät |
| **Skins** | 10 Bretter, 8 Figurensets – im Shop mit Münzen oder über den Battlepass |
| **Battlepass** | 30 Stufen, Gratis- und Premium-Spur, XP aus jeder Partie (gewertet ×1,5) |

Alle Belohnungen, Käufe und Elo-Änderungen werden **auf dem Server** berechnet. KI-Siege werden anhand der eingereichten PGN geprüft (die Partie muss regelkonform und beendet sein).

## Aufbau

```
server/index.js     HTTP-API + statische Dateien
server/online.js    WebSocket: Matchmaking, Räume, Partien, Uhren
server/progress.js  Shop, Battlepass, Elo-/Belohnungslogik
server/db.js        JSON-Datei-Speicher (data/db.json)
shared/catalog.js   Skins, Battlepass-Stufen, Elo-Formel (Server + Browser)
public/             Oberfläche (app.js), KI (ai-worker.js), SVG-Figuren (pieces.js)
test/               Unit-Tests (npm test)
```

## Ideen für später

- Echte Datenbank (SQLite/Postgres) statt JSON-Datei
- Stärkere KI (z. B. Stockfish als WebAssembly)
- Freundesliste, Turniere, tägliche Aufgaben, Partie-Analyse
- Saisons mit Elo-Reset und Saison-Belohnungen
