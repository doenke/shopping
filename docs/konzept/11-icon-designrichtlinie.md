# 11 – Icon-Designrichtlinie

*Stand: Oktober 2026.*

Gilt für alle Icons: Artikel, Kategorien, Merklisten-Einträge und Listen. Ziel: freundlich, sofort
erkennbar, auch bei 32 px, einheitlich – ein Icon soll nie „herausfallen“.

## Stil in einem Satz

**Weiche, flache Illustration eines einzelnen Objekts, leicht von schräg
oben, 2–4 Tonwerte pro Farbe, keine Konturlinie, transparenter Hintergrund,
kein Text.**

## Leinwand & Raster

| Regel | Wert |
|-------|------|
| Master-Format | 512 × 512 px mit Alpha, gespeichert als WebP (Kachelbild 192 px) |
| Safe Area | 448 × 448 px (32 px Rand ringsum frei) |
| Füllgrad | Objekt nimmt 70–85 % der Safe Area ein, optisch zentriert |
| Rundliche Objekte (Apfel, Tomate) | Kreisförmig ~ 400 px Durchmesser |
| Hohe Objekte (Flasche) | volle Höhe der Safe Area, schmal |
| Breite Objekte (Baguette) | leicht diagonal (≈ 30°) statt quer, um die Fläche zu nutzen |
| Hintergrund | transparent – die **Kachel** liefert die Farbe, nicht das Icon |

## Perspektive & Komposition

- Blickwinkel: frontal bis leicht von oben (ca. 15–20°), bei Behältern
  (Dose, Becher, Packung) leichte 3/4-Ansicht, damit sie räumlich wirken.
- **Ein Objekt** oder eine kleine typische Gruppe, wenn der Artikel so
  gekauft wird: Eier (2–3), Trauben (Rispe), Kartoffeln (2–3), Zwiebeln (2).
- Lose Ware als Ware, nicht als Verpackung (Hackfleisch: Portion auf
  kleiner Schale, nicht Supermarktverpackung mit Folie und Etikett).
- Verpackte Ware **generisch**: Milchtüte ohne Schrift, Joghurtbecher mit
  Farbfläche statt Logo, Klopapier als Rolle.
- Unterscheidung naher Artikel über klare Merkmale:
  - Vollmilch vs. Hafermilch: Tüte + Hafer-Ähre als Akzent;
  - Sahne vs. Milch: kleinere Packung/Becher;
  - rote vs. weiße Zwiebel: Farbe;
  - Weißwein vs. Rotwein: Flaschen-/Weinfarbe.

## Farbe & Licht

- Natürliche, leicht entsättigte Farben (nicht neonbunt, nicht pastellig-blass).
- Je Farbfläche: Grundton + 1 Schatten + 1 Licht (+ optional 1 Akzent).
- Lichtquelle **oben links**, konsistent über alle Icons.
- Glanzpunkt (Highlight) klein, weich, oben links – nur bei glatten Oberflächen.
- **Keine** Schlagschatten auf den Boden, kein Glow, keine Verläufe über das ganze Objekt.
- Kein reines Weiß (#FFF) und kein reines Schwarz für große Flächen:
  weiße Objekte (Milch, Eier) in warmem Hellgrau/Creme (#F3EEE6 …) mit
  sichtbarem Schatten, damit sie auf heller Kachel funktionieren.
- Muss auf **beiden** Kachelhintergründen funktionieren: hell (Kategoriefarbe
  bei ~15 % Deckkraft) und dunkel (Dark Mode). Kontrolle in der Review-Ansicht.

## Formen & Details

- Klare, geschlossene Silhouette – Erkennbarkeit über die Umrisslinie bei 32 px testen.
- Abgerundete Ecken, weiche Formen, keine dünnen, filigranen Details
  (Mindeststrichstärke auf 512 px: ~8 px).
- Keine Kontur-/Outline-Linie; Formen grenzen sich über Tonwerte ab.
- Maximal 3–5 Detailelemente (z. B. Blatt, Stiel, Glanz).
- Keine Gesichter, keine Hände, keine Szenen, keine Teller-Arrangements.

## Einträge und Listen

- **Merklisten-Einträge** zeigen ein Motiv, das den Eintrag erkennen lässt: beim Film ein
  Schlüsselobjekt aus der Geschichte (keine Schauspieler, keine Gesichter, kein Titel), beim Buch ein
  geschlossenes Buch mit schlichtem Motiv auf dem Umschlag, beim Restaurant ein typisches Gericht der
  Küche, beim Ort ein typisches Objekt.
- **Listen** zeigen ein Objekt, das für den Zweck steht: Baumarkt → Hammer, Skiurlaub → Ski,
  Filme → Filmklappe, Garten → Gießkanne, Wocheneinkauf → Papiertüte mit Einkäufen.
- Beides nach denselben Regeln wie Artikel-Icons: ein Motiv, kein Text, keine echten Personen.

## Verboten

- Text, Buchstaben, Zahlen, Preisschilder
- Markenlogos, erkennbare Markenverpackungen
- Fotorealismus, 3D-Render-Look mit Spiegelungen
- Rahmen, Hintergründe, Vignetten
- Mehrere unterschiedliche Objekte (Ausnahme: Kategorie-Icons, s. u.)

## Kategorie-Icons

Wie Artikel-Icons, aber als kleine Komposition aus 2–3 typischen Objekten
der Kategorie (Obst & Gemüse: Apfel + Karotte + Blatt). Gleiche Licht-
und Farbregeln.

## Kachel (gehört zur App, nicht zum Icon)

| Element | Regel |
|---------|-------|
| Form | Quadrat mit Radius 16 % |
| Hintergrund | Kategoriefarbe, hell: 15 % Deckkraft, dunkel: 25 % |
| Icon | 64 % der Kachelbreite, zentriert, oberhalb des Namens |
| Name | 1–2 Zeilen, darunter Spezifikation (Menge · Eigenschaften) in kleinerer Schrift |
| Abgehakt-Zustand | wird von der App gerendert (Animation, Häkchen), nie im Icon |

## Prompt

Der Prompt entsteht in `apps/server/src/icons/prompt.ts`:

```
Icon of {bildbeschreibung}.
[It stands for {kontext}, drawn as an object, without any title or text.]   ← Einträge
[{Zusatzwunsch aus der Übersicht}.]
Soft flat vector-style illustration, no outlines, 2-4 tonal shades per color,
soft light from top-left, small soft highlight, natural slightly desaturated colors,
rounded friendly shapes, simple silhouette readable at 32 px.          ← Stilsatz, in den Einstellungen änderbar
Centered on a solid flat pure magenta (#FF00FF) background with generous empty margin,
nothing touches the edges.                                              ← bzw. transparent, je nach Anbieter
No text, no letters, no logos, no labels, no shadow on the ground, no frame, no plate,
no hands, no background scene.
Match the exact drawing style, lighting, color treatment and level of detail of the
reference images, but draw the new subject.                             ← mit Stil-Referenzen
```

Die Bildbeschreibung ist eine kurze englische Phrase, die sagt, was und wie viel zu sehen ist
(im Grundkatalog fest hinterlegt, sonst von Claude oder einem Textmodell erzeugt und in der Übersicht
änderbar):

| Ziel | Beispiel |
|------|----------|
| Kartoffeln | `group of three potatoes, one slightly in front` |
| Milch | `plain white carton of milk with a small blue band, three-quarter view` |
| Ladekabel (Packliste) | `phone charger with a coiled cable` |
| „Dune“ (Merkliste „Filme“) | `a sandworm rising from desert dunes` |
| Liste „Baumarkt“ | `a hammer` |

## Abnahme-Checkliste (pro Icon)

- [ ] bei 32 px eindeutig erkennbar
- [ ] auf heller und dunkler Kachel gut sichtbar
- [ ] Licht von oben links, kein Bodenschatten
- [ ] keine Schrift, kein Logo
- [ ] Safe Area eingehalten, Füllgrad passt zu den Nachbar-Icons
- [ ] neben 3 zufälligen freigegebenen Icons kein Stilbruch
