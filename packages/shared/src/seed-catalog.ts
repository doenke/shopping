/**
 * Built-in base catalog. One line per item:
 *   Name | Aliase (kommagetrennt) | Standardeinheit | p (= meist vorrätig)
 * grouped by category id.
 */
const DATA: Record<string, string> = {
  'obst-gemuese': `
Äpfel|Apfel
Bananen|Banane
Birnen|Birne
Orangen|Orange,Apfelsine,Apfelsinen
Mandarinen|Mandarine,Clementinen,Clementine
Zitronen|Zitrone
Limetten|Limette
Grapefruit|
Weintrauben|Trauben,Traube,Weintraube
Erdbeeren|Erdbeere
Himbeeren|Himbeere
Heidelbeeren|Blaubeeren,Heidelbeere,Blaubeere
Kirschen|Kirsche
Pflaumen|Pflaume,Zwetschgen,Zwetschge
Pfirsiche|Pfirsich
Nektarinen|Nektarine
Aprikosen|Aprikose
Kiwis|Kiwi
Mango|Mangos
Ananas|
Melone|Wassermelone,Honigmelone
Avocados|Avocado
Granatapfel|
Tomaten|Tomate,Paradeiser
Cherrytomaten|Kirschtomaten,Cocktailtomaten
Gurke|Gurken,Salatgurke
Paprika|Paprikaschote
Zucchini|
Aubergine|Auberginen
Kartoffeln|Kartoffel,Erdäpfel,Erdapfel,Grumbeere|kg
Süßkartoffeln|Süßkartoffel
Zwiebeln|Zwiebel
Rote Zwiebeln|Rote Zwiebel
Frühlingszwiebeln|Frühlingszwiebel,Lauchzwiebeln
Schalotten|Schalotte
Knoblauch|Knoblauchzehe|stk|p
Ingwer|
Möhren|Karotten,Karotte,Möhre,Mohrrüben
Lauch|Porree
Sellerie|Staudensellerie,Knollensellerie
Brokkoli|Broccoli
Blumenkohl|
Kohlrabi|
Weißkohl|Kohl
Rotkohl|Blaukraut,Rotkraut
Wirsing|
Rosenkohl|
Spinat|Blattspinat
Mangold|
Kopfsalat|Salat
Eisbergsalat|
Feldsalat|
Rucola|Rauke
Salatmix|Pflücksalat
Champignons|Pilze,Champignon
Mais|Maiskolben
Kürbis|Hokkaido
Fenchel|
Spargel|
Rote Bete|Rote Beete
Radieschen|
Rettich|
Pastinaken|Pastinake
Bohnen grün|Grüne Bohnen,Prinzessbohnen
Erbsen frisch|Zuckerschoten
Petersilie||bund
Schnittlauch||bund
Basilikum|
Koriander|
Dill|
Minze|
Rosmarin|
Thymian|
Chili|Chilischote,Peperoni
`,
  'brot-gebaeck': `
Brot|Bauernbrot,Mischbrot
Vollkornbrot|
Toastbrot|Toast
Brötchen|Semmeln,Schrippen,Weck,Wecken
Baguette|
Croissants|Croissant
Brezeln|Brezel,Breze,Laugenbrezel
Knäckebrot|
Wraps|Tortillas,Tortilla
Pita|Fladenbrot
Burgerbrötchen|Burger Buns,Buns
Kuchen|
Zwieback|
`,
  'milch-kaese': `
Milch|Vollmilch,Frischmilch|l
H-Milch|Haltbare Milch|l
Hafermilch|Haferdrink|l
Butter||pck
Margarine|
Joghurt|Jogurt
Griechischer Joghurt|
Quark|Magerquark
Skyr|
Sahne|Schlagsahne,Schlagrahm
Saure Sahne|Schmand,Sauerrahm
Crème fraîche|Creme fraiche,Creme Fraiche
Frischkäse|
Schmelzkäse|
Käse|
Gouda|
Emmentaler|
Mozzarella|
Parmesan|
Feta|Schafskäse
Hirtenkäse|
Camembert|
Brie|
Reibekäse|Geriebener Käse,Pizzakäse
Halloumi|Grillkäse
Hüttenkäse|
Mascarpone|
Ricotta|
Eier|Ei|stk
Pudding|
Buttermilch|
Kefir|
`,
  'fleisch-fisch': `
Hackfleisch|Hack,Gehacktes,Faschiertes|g
Rinderhack|
Hähnchenbrust|Hühnerbrust,Hähnchenbrustfilet
Hähnchenschenkel|
Hähnchen|Huhn
Putenbrust|Pute
Schnitzel|
Schweinefilet|
Rindersteak|Steak
Gulasch|Gulaschfleisch
Bratwurst|Bratwürste
Würstchen|Wiener,Wienerle,Frankfurter
Speck|Bacon,Schinkenwürfel,Speckwürfel
Schinken|Kochschinken
Salami|
Aufschnitt|Wurst
Leberwurst|
Lachs|Lachsfilet
Räucherlachs|
Thunfisch|Thunfisch Dose
Fischstäbchen|
Garnelen|Shrimps,Krabben
Tofu|
`,
  'zutaten-gewuerze': `
Mehl|Weizenmehl||p
Zucker|||p
Puderzucker|
Brauner Zucker|
Vanillezucker|
Backpulver|
Hefe|Trockenhefe
Salz|||p
Pfeffer|||p
Paprikapulver|
Curry|Currypulver
Zimt|
Muskat|Muskatnuss
Oregano|
Kreuzkümmel|Cumin
Gemüsebrühe|Brühe,Bouillon
Olivenöl||flasche|p
Sonnenblumenöl|Öl,Rapsöl|flasche|p
Essig|Weißweinessig|flasche|p
Balsamico|Balsamicoessig
Senf|
Ketchup|
Mayonnaise|Mayo
Sojasauce|Sojasoße
Tomatenmark|
Passierte Tomaten|Passata
Gehackte Tomaten|Dosentomaten,Tomaten Dose
Kokosmilch|
Honig|
Marmelade|Konfitüre
Nutella|Nuss-Nougat-Creme
Erdnussbutter|
Speisestärke|Stärke
Schokolade zum Backen|Kuvertüre,Backschokolade
Nüsse|Walnüsse,Haselnüsse
Mandeln|
Rosinen|
Sesam|
Pinienkerne|
`,
  'fertig-tk': `
Tiefkühlpizza|Pizza
Pommes|Pommes frites
Tiefkühlgemüse|TK-Gemüse
Erbsen|TK-Erbsen
Rahmspinat|
Eis|Eiscreme,Speiseeis
Pesto|
Fertigsoße|Soße,Sauce
Suppe|
Mais Dose|Dosenmais
Kidneybohnen|
Kichererbsen|
Linsen|
Weiße Bohnen|
Oliven|
Gewürzgurken|Essiggurken,Gurken im Glas
Sauerkraut|
Fertiggericht|
Gnocchi|
Tortellini|
Maultaschen|
Frische Nudeln|
`,
  getreide: `
Nudeln|Pasta,Penne,Fusilli,Farfalle
Spaghetti|
Lasagneplatten|
Reis|Basmatireis,Jasminreis
Risottoreis|
Couscous|
Bulgur|
Quinoa|
Haferflocken|
Müsli|
Cornflakes|
Paniermehl|Semmelbrösel
`,
  'snacks-suesses': `
Schokolade|
Chips|Kartoffelchips
Kekse|Plätzchen
Gummibärchen|Fruchtgummi
Salzstangen|Brezelstangen
Popcorn|
Nüsse gesalzen|Erdnüsse,Studentenfutter
Müsliriegel|
Kuchen|
Cracker|
`,
  getraenke: `
Mineralwasser|Wasser,Sprudel|kiste
Stilles Wasser|
Apfelsaft|Saft|flasche
Orangensaft|O-Saft
Apfelschorle|Schorle
Cola|
Limonade|Limo
Eistee|
Bier||kiste
Alkoholfreies Bier|
Weißwein|
Rotwein|Wein
Sekt|Prosecco
Kaffee|Kaffeebohnen,Kaffeepulver
Espresso|
Tee|Schwarzer Tee,Grüner Tee,Kräutertee
Kakao|Kakaopulver
Zigaretten|Tabak
`,
  haushalt: `
Toilettenpapier|Klopapier,WC-Papier
Küchenrolle|Küchenpapier,Zewa
Taschentücher|Tempo
Spülmittel|
Spülmaschinentabs|Tabs,Geschirrspültabs
Waschmittel|
Weichspüler|
Müllbeutel|Mülltüten
Gefrierbeutel|
Frischhaltefolie|
Alufolie|Aluminiumfolie
Backpapier|
Schwämme|Schwamm,Spülschwamm
Allzweckreiniger|Reiniger
WC-Reiniger|
Glasreiniger|
Batterien|
Kerzen|
Servietten|
`,
  pflege: `
Zahnpasta|Zahncreme
Zahnbürste|
Zahnseide|
Duschgel|
Shampoo|
Spülung|Haarspülung
Seife|Handseife
Deo|Deodorant
Rasierer|Rasierklingen
Sonnencreme|
Bodylotion|Creme
Wattepads|
Wattestäbchen|
Tampons|
Binden|
Windeln|
Feuchttücher|
Pflaster|
Ibuprofen|Schmerztabletten
`,
  tierbedarf: `
Katzenfutter|
Hundefutter|
Katzenstreu|
Leckerlis|
`,
  'baumarkt-garten': `
Blumenerde|Erde
Glühbirnen|Leuchtmittel,Glühbirne
Blumen|Blumenstrauß
Grillkohle|Kohle
`,
};

/** Packing list catalog (list type "packing"), same line format. */
const PACKING_DATA: Record<string, string> = {
  dokumente: `
Personalausweis|Ausweis,Perso
Reisepass|Pass
Führerschein
Krankenversicherungskarte|Versichertenkarte,Gesundheitskarte
Auslandskrankenversicherung
Bargeld|Geld
EC-Karte|Bankkarte,Girokarte
Kreditkarte
Tickets|Fahrkarten,Bordkarte,Boardingpass
Buchungsbestätigung|Hotelbuchung,Reservierung
Impfpass
Kinderreisepass
Fahrzeugschein
Visum
`,
  kleidung: `
T-Shirts|T-Shirt,Shirt,Shirts
Unterhosen|Unterhose,Unterwäsche
Socken
Hosen|Hose,Jeans
Kurze Hosen|Shorts,kurze Hose
Pullover|Pulli,Sweatshirt
Hemden|Hemd,Bluse,Blusen
Kleid|Kleider,Rock
Jacke|Regenjacke
Winterjacke
Schlafanzug|Pyjama,Nachthemd
Badesachen|Badehose,Badeanzug,Bikini
Mütze|Kappe,Cap
Sonnenhut|Hut
Schal
Handschuhe
Gürtel
Sportkleidung|Sportsachen
`,
  schuhe: `
Turnschuhe|Sneaker,Laufschuhe
Wanderschuhe
Sandalen
Badelatschen|Flip-Flops,Badeschlappen
Hausschuhe|Puschen
Gummistiefel
Gute Schuhe|Lederschuhe
`,
  koerperpflege: `
Zahnbürste
Zahnpasta|Zahncreme
Duschgel
Shampoo
Deo|Deodorant
Haarbürste|Kamm
Rasierer|Rasierapparat
Sonnencreme|Sonnenschutz
After-Sun
Gesichtscreme|Creme
Bodylotion
Kontaktlinsen|Kontaktlinsenmittel
Brille|Ersatzbrille
Taschentücher
Haargummis
Make-up|Schminke
Nagelschere|Nagelfeile
Kulturbeutel
Handtuch|Handtücher
Lippenpflege|Labello
`,
  reiseapotheke: `
Medikamente|Tabletten
Schmerztabletten|Ibuprofen,Paracetamol
Pflaster
Mückenschutz|Autan,Insektenschutz
Desinfektionsmittel
Fieberthermometer
Mittel gegen Reiseübelkeit|Reisetabletten
Durchfallmittel
Zeckenzange
Verbandszeug
`,
  technik: `
Handy|Smartphone
Ladekabel|Kabel
Ladegerät|Netzteil
Powerbank
Kopfhörer
Laptop|Notebook
Tablet
Kamera|Fotoapparat
Reiseadapter|Adapter,Steckdosenadapter
Mehrfachsteckdose
E-Book-Reader|Kindle
Taschenlampe|Stirnlampe
Uhr|Smartwatch
`,
  unterwegs: `
Wasserflasche|Trinkflasche
Snacks|Proviant
Reisekissen|Nackenkissen
Buch|Bücher
Sonnenbrille
Regenschirm|Schirm
Rucksack|Tagesrucksack
Taschen|Einkaufstasche,Beutel
Schlüssel|Hausschlüssel
Thermoskanne
Brotdose
`,
  freizeit: `
Spiele|Kartenspiel,Brettspiel
Strandtuch|Badetuch
Schwimmbrille|Taucherbrille
Fahrradhelm|Helm
Wanderkarte|Karte
Fernglas
Yogamatte
Skiausrüstung|Skier,Skibrille
`,
  kinder: `
Windeln
Feuchttücher
Schnuller
Kuscheltier
Fläschchen|Babyflasche
Babynahrung|Brei
Kinderwagen|Buggy
Kindersitz
Spielzeug
Malsachen|Buntstifte
Wickelunterlage
Babyphone
`,
  ausruestung: `
Zelt
Schlafsack
Isomatte
Campingkocher|Gaskocher
Geschirr|Besteck
Taschenmesser
Kühlbox
Wäscheleine|Wäscheklammern
Müllbeutel
Bettwäsche|Bettzeug
Grill
`,
  'packen-sonstiges': `
Geschenk|Mitbringsel
Notizbuch|Stift
Wäschesack|Wäschebeutel
Ohrstöpsel|Oropax
Schlafmaske
Vorhängeschloss|Schloss
`,
};

export interface SeedItem {
  name: string;
  aliases: string[];
  categoryId: string;
  defaultUnit: string | null;
  pantry: boolean;
  kind: 'shopping' | 'packing';
}

export function seedCatalog(): SeedItem[] {
  return [...parse(DATA, 'shopping'), ...parse(PACKING_DATA, 'packing')];
}

function parse(data: Record<string, string>, kind: SeedItem['kind']): SeedItem[] {
  const out: SeedItem[] = [];
  const seen = new Set<string>();
  for (const [categoryId, block] of Object.entries(data)) {
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const [name, aliases = '', unit = '', flags = ''] = line.split('|').map((s) => s.trim());
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({
        name,
        aliases: aliases ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : [],
        categoryId,
        defaultUnit: unit || null,
        pantry: flags.includes('p'),
        kind,
      });
    }
  }
  return out;
}
