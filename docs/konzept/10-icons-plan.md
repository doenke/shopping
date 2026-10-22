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

- Ein Icon pro Kategorie (~17), dient als Fallback für Artikel ohne eigenes Icon.
- Letzter Fallback: Anfangsbuchstabe auf Kategoriefarbe (so wie ein Avatar).
- Damit ist die App ab Tag 1 vollständig bebildert.

### Phase 3 – Massengenerierung nach Priorität

- Reihenfolge nach Nutzung: erst die häufigsten Artikel aus `item_history`
  und den Mealie-Einkaufslisten, dann der Rest des Katalogs.
- Batches à 25–50 Artikel. Pro Artikel 2–4 Kandidaten.
- Grobe Kosten: ~1.000 Artikel × 3 Kandidaten ≈ 3.000 Bilder; je nach Modell
  ein- bis niedriger zweistelliger Eurobetrag, lokal (SDXL/FLUX) nur Strom.

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
                     Automatische Checks ──► Review-Queue (Admin-UI) ──► freigegeben
                     (Transparenz, Rand frei,     Kandidaten nebeneinander,  icon.status=approved
                      Füllgrad, Farbanzahl,       auf hell & dunkel, 32–96 px;
                      kein Text per OCR)          Freigeben / Neu / Prompt anpassen
```

### Modellwahl

Anforderungen: Stil-Referenzbilder, transparenter Hintergrund (oder sauber
freistellbar), gute Objekttreue bei Lebensmitteln, API-Zugang.

| Option | Pro | Contra |
|--------|-----|--------|
| OpenAI `gpt-image` | sehr gute Prompt-Treue, Referenzbilder, transparenter Hintergrund nativ | Kosten pro Bild, Cloud |
| Google Gemini / Imagen | gute Konsistenz mit Referenzbildern | Freistellen nötig |
| FLUX (z. B. via Replicate) + Style-LoRA | sehr konsistent nach LoRA-Training auf Anker-Set | LoRA-Training-Aufwand |
| Lokal: SDXL/FLUX + LoRA (ComfyUI) | keine laufenden Kosten, volle Kontrolle | GPU nötig, mehr Bastelei |

**Empfehlung:** Phase 1 mit einem Cloud-Modell mit Referenzbild-Support
(schnell iterieren). Wenn der Stil steht, entscheiden, ob für die Masse
ein LoRA auf das Anker-Set trainiert wird. Der Generator ist im Code eine
austauschbare Schnittstelle (`IconGenerator`).

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
