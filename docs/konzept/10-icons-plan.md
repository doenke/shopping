# 10 – Icons: Plan

Ziel: Jeder Katalogartikel bekommt ein eigenes, **einheitlich gestaltetes**
Icon – generiert per Bild-KI, geprüft durch einen Menschen, versioniert.
Die Gestaltung ist in der [Designrichtlinie](11-icon-designrichtlinie.md)
festgelegt.

## Grundsatz: Konsistenz vor Menge

Das größte Risiko generierter Icons ist ein Stil-Flickenteppich. Deshalb:

1. Erst eine kleine **Stil-Referenz** („Anker-Set“) erarbeiten und festschreiben.
2. Dann alle weiteren Icons **mit diesen Referenzbildern** generieren
   (Bild-zu-Bild/Style-Reference), nicht nur per Textprompt.
3. Jedes Icon wird vor Freigabe angesehen.

## Phasen

### Phase 1 – Stil finden (einmalig, ~1 Abend)

- 12 repräsentative Artikel wählen, die die Spannbreite abdecken:
  Apfel, Banane, Karotte, Brot, Milch (Tüte), Käse, Eier, Hackfleisch,
  Nudeln, Tomatendose, Klopapier, Kaffee.
- 3–4 Stilvarianten nach Richtlinie generieren, nebeneinander auf
  hellem und dunklem Kachelhintergrund in 32/48/96 px vergleichen.
- Gewinnerstil verfeinern → **Anker-Set** (12 Icons) freigeben.
  Diese liegen im Repo unter `assets/icons/anchor/` und sind ab dann
  Pflicht-Referenz für jede Generierung.

### Phase 2 – Kategorie-Icons + Fallback

- Ein Icon pro Kategorie (14, wie bei Bring!), dient als Fallback für Artikel ohne eigenes Icon.
- Letzter Fallback: Anfangsbuchstabe auf Kategoriefarbe (so wie ein Avatar).
- Damit ist die App ab Tag 1 vollständig bebildert.

### Phase 3 – Massengenerierung nach Priorität

- Reihenfolge nach Nutzung: erst die häufigsten Artikel aus `item_history`
  und den Mealie-Einkaufslisten, dann der Rest des Katalogs.
- Batches à 25–50 Artikel. Pro Artikel 2–4 Kandidaten.
- Umfang und Tempo: siehe „Generierung mit Tagesbudget“ unten.

### Phase 4 – Laufender Betrieb

- Neuer Katalogartikel → Icon-Job wird automatisch eingeplant.
- Nutzer können „Icon gefällt mir nicht“ melden → Neugenerierung in der Review-Queue.

## Pipeline

```
catalog_item ──► Prompt-Builder ──► Bild-KI (+ Anker-Referenzen) ──► Rohbild 1024²
                  (Vorlage aus 11)                                    │
                                                                      ▼
                     Nachbearbeitung (sharp): Freistellen/Transparenz prüfen,
                     auf Objekt zuschneiden, Safe-Area-Padding, 512² PNG Master,
                     Exporte 192² / 96² WebP, (optional Vektorisierung)
                                                                      │
                                                                      ▼
                     Automatische Checks ──► Review-Queue (App) ───────► freigegeben
                     (Transparenz, Rand frei,     Kandidaten nebeneinander,  icon.status=approved
                      Füllgrad, Farbanzahl,       auf hell & dunkel, 32–96 px;
                      kein Text per OCR)          Freigeben / Neu / Prompt anpassen
```

### Modellwahl: erst kostenlos, langsam – dann notfalls bezahlt

Rahmen: **keine GPU**, aber **Zeit**. Also: Gratis-Kontingente von
Cloud-Diensten nutzen und die Generierung über Tage/Wochen strecken.

Anforderungen an das Modell: Stil-Referenzbilder (wichtig für Konsistenz),
gute Objekttreue bei Lebensmitteln, API-Zugang, transparenter Hintergrund
oder sauber freistellbar.

| Option | Kosten | Referenzbilder | Einschätzung |
|--------|--------|----------------|--------------|
| **Google Gemini (Bild-Modell) über AI Studio / Gemini API** | Gratis-Kontingent mit Tageslimit (Umfang beim Bau prüfen), danach günstig pro Bild | ✅ | **Erste Wahl**: Referenzbilder + Gratis-Stufe |
| Cloudflare Workers AI (FLUX schnell o. Ä.) | tägliches Gratis-Kontingent | ❌ nur Text | Fallback; Konsistenz nur über strengen Prompt |
| OpenAI `gpt-image` | bezahlt, wenige Cent pro Bild | ✅, transparenter Hintergrund nativ | **Bezahl-Option**, falls Gratis nicht reicht oder Qualität fehlt |
| Replicate / fal (FLUX + Stil-Referenz bzw. LoRA) | bezahlt pro Bild/Training | ✅ | Option, wenn ein trainiertes Stil-LoRA nötig wird |

Konkrete Gratis-Limits ändern sich häufig – sie werden beim Bau geprüft,
nicht im Konzept festgeschrieben.

### Generierung mit Tagesbudget

- Der Icon-Job hat ein **Tageskontingent** pro Anbieter (z. B. „max. 80
  Bilder/Tag“) und arbeitet die Warteschlange nach Priorität ab. Ist das
  Kontingent erschöpft oder meldet der Dienst `429`, pausiert der Job bis
  zum nächsten Tag.
- Rechnung: ~600 relevante Artikel × 3 Kandidaten ≈ 1.800 Bilder → bei
  ~80/Tag gut drei Wochen. Durch Priorisierung sind die häufigen Artikel
  schon nach wenigen Tagen fertig; der Rest hat ja Kategorie-Fallbacks.
- Optional **Bezahl-Schalter** mit Kostenobergrenze (z. B. „max. 10 €“),
  falls es schneller gehen soll oder ein Artikel im Gratis-Modell nicht
  gelingt („mit Bezahl-Modell neu erzeugen“ in der Review-Ansicht).
- Phase 1 (Stil finden) geht auch ganz ohne Code direkt in der Weboberfläche
  von AI Studio bzw. ChatGPT – die Gewinner werden einfach ins Repo gelegt.

Der Generator ist im Code eine austauschbare Schnittstelle
(`IconGenerator` mit Adaptern je Anbieter), Anbieter-Wechsel ist Konfiguration.

### Datenhaltung

`icon`: id, catalog_item_id, version, status (`candidate`/`approved`/`rejected`),
model, prompt, seed, reference_set_version, created_at, Dateipfade.
Dateien unter `/data/icons/{catalog_item_id}/{version}/`.
Freigegebene Icons werden zu einem versionierten **Icon-Bündel** gepackt, das
die PWA offline cached und per Delta aktualisiert.

### Rechtliches

- Nutzungsbedingungen des gewählten Modells für kommerzielle/öffentliche
  Nutzung prüfen (bei rein privater Nutzung unkritisch).
- Keine Markenlogos, keine echten Produktverpackungen (siehe Richtlinie).
