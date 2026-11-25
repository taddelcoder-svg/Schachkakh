-- Speicher für Schachkakh. Nur nötig, wenn die Tabelle noch nicht existiert
-- (die Rangliste der Spielesammlung legt dieselbe Tabelle bereits an – dann einfach überspringen).
-- Schachkakh speichert alles als eine JSON-Zeile mit id = 'schachkakh'.
create table if not exists public.rangliste_speicher (
  id           text primary key,
  daten        jsonb not null,
  geaendert_am timestamptz not null default now()
);
alter table public.rangliste_speicher enable row level security;
-- Absichtlich keine Policies: Nur der Server mit dem service_role-Schlüssel kommt an die Daten.
