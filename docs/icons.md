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
  Tageslimit (Standard 150 Bilder/Tag).
- **Automatisch freigeben**: Ein Entwurf wird freigegeben, sobald er alle Prüfungen besteht (Hintergrund
  sauber, nichts abgeschnitten, nicht zu klein und – mit Anthropic-Key – die KI-Vorprüfung). Weitere Entwürfe
  werden dann gar nicht erst erzeugt. Durchgefallenes steht unter „Nicht bestanden“ und lässt sich trotzdem
  nehmen. Wer lieber selbst auswählt, schaltet „Automatisch freigeben“ ab.
- **Neue Einträge** kommen sofort dran: Merklisten-Einträge und frei getippte Einträge auf Einkaufs- und
  Packlisten, die nicht im Katalog stehen. Ein frei getippter Name bekommt ein Bild, das jeder Eintrag mit
  diesem Namen auf jeder Liste mitbenutzt.
- **Mit Kontext**: In die Bildbeschreibung geht ein, wofür das Icon ist – Lebensmittel, etwas zum Einpacken,
  ein Film, eine ganze Liste. Bei frei getippten Einträgen hilft der Listentitel („Mutter“ auf „Baumarkt“),
  bei Merklisten die Listenbeschreibung, bei ToDo-Listen deren Kategorie.
- **Listen-Icons** entstehen aus Name und Beschreibung der Liste und ersetzen in Seitenleiste und Titelzeile
  das Typ-Symbol. Nach dem Umbenennen entsteht ein neues; *⋮ → Neues Listen-Icon* erzeugt jederzeit eins.
- In der App kann jeder über das Artikel-Menü „Icon gefällt mir nicht“ melden.

## Optionale Anbieter

- **Anthropic (Claude)**: Claude zeichnet Icons als SVG (Sonnet, etwa 3–4 Cent pro Entwurf), prüft jeden
  Entwurf vorab („erkennbar? Schrift? passt zum Stil?“, Haiku, unter 0,1 Cent) und beschreibt Artikel aus
  Mealie. Was die Vorprüfung aussortiert, steht hinten und ist blass, bleibt aber wählbar; fällt alles durch,
  gibt es automatisch einen zweiten Versuch.
- **OpenAI** (gpt-image) als bezahlte Alternative.

Für Claude und OpenAI gilt je eine Monatsgrenze in €. Wie die Icons aussehen sollen, steht in der
[Designrichtlinie](konzept/11-icon-designrichtlinie.md).
