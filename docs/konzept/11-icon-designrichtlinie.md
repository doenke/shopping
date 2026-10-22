# 11 – Icon-Designrichtlinie

Gilt für alle Artikel- und Kategorie-Icons. Ziel: freundlich, sofort
erkennbar, auch bei 32 px, einheitlich – ein Icon soll nie „herausfallen“.

## Stil in einem Satz

**Weiche, flache Illustration eines einzelnen Objekts, leicht von schräg
oben, 2–4 Tonwerte pro Farbe, keine Konturlinie, transparenter Hintergrund,
kein Text.**

## Leinwand & Raster

| Regel | Wert |
|-------|------|
| Master-Format | 512 × 512 px, PNG mit Alpha (Exporte 192/96 px WebP) |
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

- Natürliche, leicht entsättigte Lebensmittelfarben (nicht neonbunt, nicht pastellig-blass).
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

## Prompt-Vorlage

```
A single {objekt_en} {gruppierung}, {ansicht}.
Soft flat vector-style illustration, no outlines, 2-4 tonal shades per color,
soft light from top-left, small soft highlight, natural slightly desaturated
food colors, rounded friendly shapes, simple silhouette readable at 32 px.
Centered on a fully transparent background with generous empty margin.
No text, no letters, no logos, no labels, no shadow on the ground, no
background, no frame, no plate, no hands.
Match the exact style of the reference images.
```

Platzhalter je Artikel (im Katalog gepflegt, bei Bedarf per LLM vorgeschlagen):

| Platzhalter | Beispiel Kartoffeln | Beispiel Milch |
|-------------|---------------------|----------------|
| `objekt_en` | potatoes | carton of milk |
| `gruppierung` | group of three | – |
| `ansicht` | front view, slightly from above | three-quarter view |
| Zusatz | „one potato slightly in front“ | „plain white carton with a small blue color band, no text“ |

## Abnahme-Checkliste (pro Icon)

- [ ] bei 32 px eindeutig erkennbar
- [ ] auf heller und dunkler Kachel gut sichtbar
- [ ] Licht von oben links, kein Bodenschatten
- [ ] keine Schrift, kein Logo
- [ ] Safe Area eingehalten, Füllgrad passt zu den Nachbar-Icons
- [ ] neben 3 zufälligen freigegebenen Icons kein Stilbruch
