# 10 – Icons: Pipeline

*Stand: Oktober 2026.* Die Gestaltung steht in der [Designrichtlinie](11-icon-designrichtlinie.md),
die Einrichtung in [docs/icons.md](../icons.md).

Ziel: Jeder Artikel, jede Kategorie, jeder Merklisten-Eintrag und jede Liste bekommt ein **einheitlich
gestaltetes** Icon – generiert per Bild-KI, automatisch geprüft, versioniert.

## Grundsatz: Konsistenz vor Menge

Das größte Risiko generierter Icons ist ein Stil-Flickenteppich. Deshalb:

1. Erst eine kleine **Stil-Referenz** („Anker-Set“) erarbeiten.
2. Dann alle weiteren Icons **mit diesen Referenzbildern** erzeugen, nicht nur per Textprompt.
3. Jeder Entwurf wird automatisch geprüft; Zweifelsfälle bleiben für einen Menschen liegen.

## Ablauf

1. **Stil finden**: zwölf typische Artikel (Apfel, Banane, Karotte, Brot, Milch, Käse, Eier,
   Hackfleisch, Nudeln, Tomatendose, Klopapier, Kaffee) mit je drei Entwürfen. Die ersten vier
   freigegebenen werden Stil-Referenz ★; eigene Bilder lassen sich hochladen.
2. **Kategorie-Icons** als Rückfallebene für Artikel ohne eigenes Icon; letzte Rückfallebene ist
   der Anfangsbuchstabe auf der Kategoriefarbe.
3. **Laufend** nach Priorität: Kategorien, neue Listen, neue Einträge (Merklisten-Einträge und frei
   getippte Einträge), dann die Katalogartikel nach Häufigkeit auf den Listen.
4. **Im Betrieb**: Neue Einträge werden wenige Sekunden nach der Änderung eingeplant, auch mitten in
   einem langen Durchlauf. „Icon gefällt mir nicht“ in der App und „Neu erzeugen“ in der Übersicht
   planen neu ein.

### Was ein Icon bekommt

| Ziel | Bildbeschreibung aus | Besonderheit |
|------|----------------------|--------------|
| Katalogartikel (`item`) | fester Text im Grundkatalog, sonst Claude/Textmodell aus Name und Kategorie | Packartikel mit eigenem Prompt (Dinge zum Einpacken) |
| Kategorie (`category`) | fest hinterlegt; eigene Kategorien: Claude/Textmodell aus Name und Listentyp | kleine Komposition aus 2–3 Objekten; eigene nach dem Umbenennen neu |
| Eintrag (`entry`) | Merkliste: Eintrag, Listenname, **Listenbeschreibung**, Ort; frei getippt: Name, Kategorie, **Listentitel** | frei getippte Einträge teilen sich ein Bild pro Name über alle Listen |
| Liste (`list`) | Name, Typ, Beschreibung, bei ToDo-Listen die **Kategorie** | nach dem Umbenennen neu |

Auch Bildprompt und KI-Vorprüfung wissen, wofür das Icon ist (Lebensmittel, etwas zum Einpacken,
ein Film, eine ganze Liste) – ein Symbol ist bei Merklisten, Listen und Kategorien richtig, es muss
kein Produkt sein.

## Pipeline

```
Ziel ──► Bildbeschreibung ──► Bild-KI (+ Stil-Referenzen) ──► Rohbild
                                                                │
                Nachbearbeitung (sharp): Magenta freistellen (Flutfüllung vom Rand,
                weiche Kanten, Farbsaum weg), auf Objekt zuschneiden, Objekt 392 px
                in 512er-Leinwand, Master 512 px + Kachelbild 192 px als WebP
                                                                │
                Automatische Prüfungen: Hintergrund sauber, nichts abgeschnitten,
                nicht zu klein; mit Anthropic-Key KI-Vorprüfung (erkennbar? Schrift?
                passt zum Stil?)
                                                                │
                Automatische Freigabe des ersten Entwurfs, der alles besteht
                (abschaltbar) – sonst Review-Ansicht in der App
```

## Anbieter: erst kostenlos, dann notfalls bezahlt

Rahmen: **keine GPU**, aber Zeit – Gratis-Kontingente nutzen und die Erzeugung über Tage strecken.

| Anbieter | Kosten | Referenzbilder | Rolle |
|----------|--------|----------------|-------|
| **Cloudflare Workers AI, FLUX.2 [klein]** | tägliches Gratis-Kontingent (10.000 Neurons, rund 50 je Icon mit Referenzen) | ✅ bis 4 | Standard; zeichnet auf Magenta, Shopping stellt frei |
| **Claude (SVG)** | Sonnet, rund 3–4 Cent je Entwurf | ✅ SVG-Quellen der Anker | zeichnet Vektor-Icons; SVGs werden vor dem Rendern auf erlaubte Elemente geprüft |
| **Claude (Haiku)** | unter 0,1 Cent | – | KI-Vorprüfung und Bildbeschreibungen |
| OpenAI `gpt-image` | wenige Cent je Bild | ✅, transparent | Bezahl-Alternative |

Gemini-Bildmodelle haben kein Gratis-Kontingent mehr und sind nicht eingebaut. Der Generator ist eine
austauschbare Schnittstelle (`IconGenerator`); der Anbieterwechsel ist Einstellung.

## Budget

- **Tageslimit** für Cloudflare (Standard 150 Bilder). Ist es erreicht oder meldet der Dienst sein
  Kontingent als erschöpft, pausiert die Warteschlange bis Mitternacht (UTC).
- **Monatsgrenze in €** für Claude und OpenAI; Kosten werden aus den echten Token-Zahlen verbucht.
- Nach einer Freigabe werden für dieses Ziel keine weiteren Entwürfe bezahlt.

## Datenhaltung

`icons` (Ziel, Status `candidate`/`approved`/`rejected`/`retired`, Stil-Referenz, Anbieter, Modell,
Prompt, Seed, Referenzen, Prüfergebnisse, KI-Urteil, SVG-Quelle, Master und Kachelbild als WebP
**in PostgreSQL**), `icon_jobs` (Warteschlange mit Priorität), `icon_usage` (Bilder und Kosten pro Tag).
Abgelehnte Entwürfe verlieren ihre Bilddaten.

Ausgeliefert unter `/icons/{item|category|entry|list}/{id}.webp?v=…` – öffentlich und mit
Versions-Token für immer cachebar. Die PWA lädt alle freigegebenen Icons im Hintergrund vor und hat
sie offline. Das Token steht am Katalogartikel, Eintrag oder an der Liste und wird mitsynchronisiert.

## Rechtliches

- Nutzungsbedingungen der Anbieter für öffentliche Nutzung prüfen (privat unkritisch).
- Keine Markenlogos, keine echten Produktverpackungen, keine echten Personen (siehe Richtlinie).
