/**
 * Enkel nøkkelord-basert kategorisering av dagligvarer, basert på det
 * normaliserte produktnavnet (se sync.ts sin normalizeProductName).
 *
 * Ingen ekstern kilde gir oss kategori direkte fra Trumf-eksporten, så dette
 * er en heuristikk - ikke perfekt, men gir brukbar bla-i-kategorier-visning
 * uten manuelt arbeid. Rekkefølgen på CATEGORY_RULES betyr noe: mer
 * spesifikke regler står FØR mer generelle for å unngå feilklassifisering
 * (f.eks. "kokosmelk" skal ikke havne i Meieri fordi den inneholder "melk").
 */

interface CategoryRule {
  category: string;
  keywords: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Frukt og grønt",
    keywords: [
      "banan", "eple", "appelsin", "pære", "drue", "tomat", "agurk", "salat",
      "potet", "gulrot", "avokado", "sitron", "lime", "mango", "ananas",
      "jordbær", "bringebær", "blåbær", "bær", "paprika", "brokkoli",
      "blomkål", "løk", "hvitløk", "champignon", "sopp", "squash", "mais",
      "kokosmelk", "kokosnøtt",
    ],
  },
  {
    category: "Fisk og sjømat",
    keywords: [
      "laks", "torsk", "reker", "makrell", "sild", "sjømat", "kaviar",
      "fiskepudding", "fiskeboller", "fiskekake", "rakfisk", "kveite", "ørret", "tunfisk",
    ],
  },
  {
    category: "Kjøtt og fjørfe",
    keywords: [
      "kjøttdeig", "kylling", "biff", "svin", "pølse", "bacon", "skinke",
      "karbonade", "medister", "kjøttbolle", "indrefilet", "flesk", "kalkun",
      "and", "lammekjøtt", "burger", "kjøttpålegg", "salami", "servelat",
      "leverpostei",
    ],
  },
  {
    category: "Meieri",
    keywords: [
      "melk", "yoghurt", "yogurt", "ost", "smør", "rømme", "fløte", "kesam",
      "cottage cheese", "skyr", "kefir", "margarin", "egg", "vaniljesaus", "pudding",
    ],
  },
  {
    category: "Bakervarer",
    keywords: [
      "brød", "rundstykke", "bolle", "loff", "knekkebrød", "baguette",
      "croissant", "lomper", "wienerbrød", "kake", "vaffel", "flatbrød",
    ],
  },
  {
    category: "Frost",
    keywords: ["frossen", "fryst", "iskrem", "is-", "softis"],
  },
  {
    category: "Snacks og godteri",
    keywords: [
      "sjokolade", "godteri", "chips", "snacks", "kjeks", "potetgull",
      "smågodt", "drops", "lakris", "peanøtt", "nøtter", "popcorn",
    ],
  },
  {
    category: "Drikke",
    keywords: [
      "brus", "juice", "vann", "kaffe", "te ", " te", "øl", "vin", "saft",
      "cola", "energidrikk", "smoothie", "nektar", "mineralvann",
    ],
  },
  {
    category: "Tørrvarer og kolonial",
    keywords: [
      "ris", "pasta", "mel", "sukker", "hermetikk", "olje", "eddik",
      "krydder", "saus", "suppe", "müsli", "havregryn", "korn", "grøt",
      "buljong", "gjær", "bakepulver", "honning", "syltetøy",
    ],
  },
  {
    category: "Helse og skjønnhet",
    keywords: [
      "nesespray", "tablett", "vitamin", "sjampo", "shampoo", "tannkrem",
      "deodorant", "plaster", "medisin", "krem", "såpe", "hudkrem",
      "solkrem", "smertestillende", "paracet", "ibux", "tampong", "bind",
    ],
  },
  {
    category: "Husholdning",
    keywords: [
      "vaskemiddel", "oppvaskmiddel", "toalettpapir", "tørkerull", "søppelsekk",
      "lys", "batteri", "kluter", "svamp", "folie", "bakepapir", "pose",
    ],
  },
  {
    category: "Baby og barn",
    keywords: ["bleie", "babymat", "morsmelk", "barnemat"],
  },
  {
    category: "Dyremat",
    keywords: ["hundemat", "kattemat", "dyremat", "fuglemat"],
  },
];

/**
 * Gir en kategori for et normalisert produktnavn, eller "Annet" hvis ingen
 * regel traff (bedre enn null - alt blir da synlig i kategori-visningen).
 */
export function categorizeProduct(normalizedName: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => normalizedName.includes(kw))) {
      return rule.category;
    }
  }
  return "Annet";
}
