# Icons mit Bild-KI

[← zurück zur README](../README.md)

Ohne Bild-KI zeigt die App den Anfangsbuchstaben in der Farbe der Kategorie. Mit Bild-KI bekommt jeder
Artikel, jede Kategorie, jeder Merklisten-Eintrag und jede Liste ein eigenes Icon im einheitlichen Stil.

## Einrichten

1. Kostenloses Cloudflare-Konto anlegen, unter *AI → Workers AI → REST API* die Account-ID ablesen und ein
   API-Token (Vorlage „Workers AI“) erstellen.
2. In der App *⚙ Einstellungen → 🖼 Icons verwalten → Bild-KI einrichten*: Account-ID und Token eintragen,
   speichern.
3. „Automatisch im Hintergrund“ einschalten.

## Wie es abläuft

- **Stil finden**: Zuerst entsteht der Stil an zwölf typischen Artikeln. Die ersten vier freigegebenen werden
  Stil-Referenz ★, alles Weitere wird mit ihnen als Vorlage im selben Stil erzeugt. Referenzen lassen sich in
  der Übersicht ändern.
- **Reihenfolge**: erst Kategorien, dann neue Einträge, dann die Katalogartikel nach Häufigkeit – bis zum
  Tageslimit (Standard 150 Bilder/Tag). Nur Artikel, die auf einer Liste stehen oder standen, bekommen ein
  eigenes Bild; der Rest zeigt das Kategorie-Icon, bis er zum ersten Mal gebraucht wird.
- **Gewürze** (Pulver, Samen, getrocknete Kräuter) zeichnet keine KI: Sie sind ein Häufchen aus Punkten in
  ihrer Farbe – immer dasselbe Häufchen, nur eingefärbt. Die Farbe steht für gängige Gewürze fest im Code,
  bei unbekannten aus „Zutaten & Gewürze“ fragt Shopping einmal Haiku. „Neu erzeugen“ von Hand lässt doch
  die KI zeichnen.
- **Automatisch freigeben**: Ein Entwurf wird freigegeben, sobald er alle Prüfungen besteht (Hintergrund
  sauber, nichts abgeschnitten, nicht zu klein und – mit Anthropic-Key – die KI-Vorprüfung). Weitere Entwürfe
  werden dann gar nicht erst erzeugt. Durchgefallenes steht unter „Nicht bestanden“ und lässt sich trotzdem
  nehmen. Ersetzt ein Entwurf ein vorhandenes Icon, steht das bisherige daneben; „Bisheriges behalten“
  verwirft die neuen Entwürfe, „Alle verwerfen, keins nehmen“ tut das, wo es noch keins gibt.
  Wer lieber selbst auswählt, schaltet „Automatisch freigeben“ ab.
- **Neue Einträge** kommen sofort dran: Merklisten-Einträge und frei getippte Einträge auf Einkaufs- und
  Packlisten, die nicht im Katalog stehen. Ein frei getippter Name bekommt ein Bild, das jeder Eintrag mit
  diesem Namen auf jeder Liste mitbenutzt.
- **Mit Kontext**: In die Bildbeschreibung geht ein, wofür das Icon ist – Lebensmittel, etwas zum Einpacken,
  ein Film, eine ganze Liste. Bei frei getippten Einträgen hilft der Listentitel („Mutter“ auf „Baumarkt“),
  bei Merklisten die Listenbeschreibung, bei ToDo-Listen deren Kategorie.
- **Listen-Icons** entstehen aus Name und Beschreibung der Liste und ersetzen in Seitenleiste und Titelzeile
  das Typ-Symbol. Nach dem Umbenennen entsteht ein neues; *⋮ → Bearbeiten … → Neues Icon erzeugen* erzeugt jederzeit eins.
- In der App kann jeder über das Artikel-Menü „Icon gefällt mir nicht“ melden.

## Optionale Anbieter

- **Anthropic (Claude)**: Claude zeichnet Icons als SVG (Sonnet, etwa 3–4 Cent pro Entwurf; außer beim
  Stil-Finden und „Neu erzeugen“ nur ein Entwurf pro Icon, ein zweiter nur, wenn die Vorprüfung ablehnt), prüft jeden
  Entwurf vorab („erkennbar? Schrift? passt zum Stil?“, Haiku, unter 0,1 Cent), beschreibt Artikel aus
  Mealie und sortiert neue freie Einträge in die passende Kategorie (Haiku, abschaltbar). Was die Vorprüfung aussortiert, steht hinten und ist blass, bleibt aber wählbar; fällt alles durch,
  gibt es automatisch einen zweiten Versuch.
- **OpenAI** (gpt-image) als bezahlte Alternative.
- **Sparsam kombiniert**: FLUX (Cloudflare, gratis) als Anbieter, Claude nur als **Ersatz**, wenn FLUX auch im
  zweiten Anlauf nichts Brauchbares liefert (Haken „Claude als Ersatz“, Standard an).

Für Claude und OpenAI gilt je eine Monatsgrenze in €. Wie die Icons aussehen sollen, steht in der
[Designrichtlinie](konzept/11-icon-designrichtlinie.md).
