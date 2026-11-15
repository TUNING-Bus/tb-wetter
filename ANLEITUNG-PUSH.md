# TB Wetter – Push-Nachrichten einrichten (einmalig, ca. 10 Minuten)

Alles in **Safari** (nicht Google-App). Adressen immer selbst eintippen.

## 1. Neue Dateien hochladen
github.com/TUNING-Bus/tb-wetter/upload/main → aus dem Ordner „Update-2.0“: **index.html, sw.js, push.mjs** → „Commit changes“.

## 2. Den automatischen Auftrag anlegen
github.com/TUNING-Bus/tb-wetter/new/main öffnen.
- Ins Feld „Name your file…“ genau eintippen: `.github/workflows/push.yml`
- In die große Fläche den Inhalt der Datei **push.yml** einfügen (steht auch im Chat zum Kopieren).
- „Commit changes…“ → „Commit changes“.

## 3. Zwei Schlüssel eintragen
github.com/TUNING-Bus/tb-wetter/settings/secrets/actions/new
- Name `VAPID_PUBLIC`, Secret: öffentlicher Schlüssel (aus dem Chat) → „Add secret“
- Nochmal: Name `VAPID_PRIVATE`, Secret: privater Schlüssel (aus dem Chat) → „Add secret“
Den privaten Schlüssel nicht weitergeben.

## 4. Push in der App einschalten
- TB Wetter ganz schließen, neu öffnen (Version 2.0 unter Orte ganz unten).
- Orte → Push-Nachrichten → Schalter an → „Erlauben“.
- Gewünschte Nachrichten und Uhrzeit wählen → „Code kopieren“.
- github.com/TUNING-Bus/tb-wetter/settings/secrets/actions/new → Name `PUSH_1` → Code einfügen → „Add secret“.
- Sabine macht dasselbe auf ihrem iPhone und trägt ihren Code als `PUSH_2` ein.

## 5. Ausprobieren
github.com/TUNING-Bus/tb-wetter/actions → links „Push-Nachrichten“ → „Run workflow“ → grün „Run workflow“.
Nach etwa einer Minute kommt „✅ Push funktioniert“ aufs iPhone (und auf die Watch, wenn das iPhone gesperrt ist).

## Später ändern
Orte oder Schalter geändert → in der App „Code kopieren“ → in GitHub beim Secret PUSH_1 „Update“ → neuen Code einfügen.
Push aus → Schalter in der App aus. Fertig.

Hinweise: GitHub startet den Auftrag alle 15 Minuten, manchmal ein paar Minuten später. Nachts (22–6 Uhr) kommen nur Unwetterwarnungen.
