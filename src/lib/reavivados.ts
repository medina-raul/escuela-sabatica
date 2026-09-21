import baseline from "@data/quarters/2026-q3.json";

// Continuation of the editor's Q3 calendar, not a restart at the quarter boundary.
const books: [string, number][] = [
  ["Génesis",50],["Éxodo",40],["Levítico",27],["Números",36],["Deuteronomio",34],
  ["Josué",24],["Jueces",21],["Rut",4],["1 Samuel",31],["2 Samuel",24],
  ["1 Reyes",22],["2 Reyes",25],["1 Crónicas",29],["2 Crónicas",36],["Esdras",10],
  ["Nehemías",13],["Ester",10],["Job",42],["Salmos",150],["Proverbios",31],
  ["Eclesiastés",12],["Cantares",8],["Isaías",66],["Jeremías",52],["Lamentaciones",5],
  ["Ezequiel",48],["Daniel",12],["Oseas",14],["Joel",3],["Amós",9],["Abdías",1],
  ["Jonás",4],["Miqueas",7],["Nahúm",3],["Habacuc",3],["Sofonías",3],["Hageo",2],
  ["Zacarías",14],["Malaquías",4],["Mateo",28],["Marcos",16],["Lucas",24],["Juan",21],
  ["Hechos",28],["Romanos",16],["1 Corintios",16],["2 Corintios",13],["Gálatas",6],
  ["Efesios",6],["Filipenses",4],["Colosenses",4],["1 Tesalonicenses",5],["2 Tesalonicenses",3],
  ["1 Timoteo",6],["2 Timoteo",4],["Tito",3],["Filemón",1],["Hebreos",13],["Santiago",5],
  ["1 Pedro",5],["2 Pedro",3],["1 Juan",5],["2 Juan",1],["3 Juan",1],["Judas",1],["Apocalipsis",22],
];
export type Reading = { date: string; reading: string; bookId: number; chapter: number };

export function getReavivados(date: string): Reading | undefined {
  const existing = baseline.reavivados.find(reading => reading.date === date);
  if (existing) return existing;
  const anchor = baseline.reavivados.at(-1)!;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return;
  const offset = (timestamp - Date.parse(`${anchor.date}T00:00:00Z`)) / 86400000;
  if (offset < 0 || !Number.isInteger(offset)) return;
  let bookId = anchor.bookId;
  let chapter = anchor.chapter + offset;
  while (bookId <= books.length && chapter > books[bookId - 1][1]) {
    chapter -= books[bookId - 1][1];
    bookId += 1;
  }
  if (bookId > books.length) return; // A new reading cycle requires an explicit editorial decision.
  return { date, bookId, chapter, reading: `${books[bookId - 1][0]} ${chapter}` };
}
