// Buduje paczki z bazy skał (pliki CSV w baza/, wzór Cruxlog):
//  1. Nadaje brakujące numery: ID_skały (sk-0001…) i ID_drogi (dr-0001…), kolejne w całej bazie, i wpisuje je do pliku bazy.
//     Wiersz bez numeru, który był już kiedyś zbudowany (ta sama skała, sektor i nazwa), dostaje swój dawny numer
//     (pamięć numerów: narzedzia/numery.json), więc poprawienie starej kopii pliku nie robi nowych dróg.
//  0. Sprawdza każdy wiersz tak jak aplikacja przy pobieraniu paczki: wypełnione Region, Rejon, Skała, Nazwa, Wycena,
//     znany typ i skala wycen, wycena, którą aplikacja rozpozna. Wiersz z błędem aplikacja by pominęła, więc paczki
//     nie są wtedy budowane.
//  2. Sprawdza, czy numer nie powtarza się przy dwóch różnych drogach albo skałach.
//  3. Dzieli bazę na paczki: jedna paczka = jedna grupa skał (pierwszy poziom kolumny Grupa); skały bez grupy trafiają do
//     paczki "<Rejon> – pozostałe skały". Zapisuje paczki/<id>.csv, spis index.json i NASTEPNE_NUMERY.txt.
// Kolumny są rozpoznawane po nazwach nagłówków, w dowolnej kolejności. Wersja paczki rośnie, gdy zmieni się jej zawartość.
// Uruchomienie: node narzedzia/zbuduj.mjs   (bez dodatkowych bibliotek; Node 18+)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SEP = '›';

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const headerKey = (h) => fold(h).replace(/[\s-]+/g, '_');

/** Reads CSV text (separator ; , or tab, found in the header), with quoted fields. */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); if (row.some((x) => x.trim())) rows.push(row); }
  return rows;
}

const cell = (v) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';

// The template's columns in its order (packs are written in this order; other columns follow). Each with the header names it is known by.
const TEMPLATE = [
  ['Region', ['region']], ['Rejon', ['rejon', 'area']], ['Grupa', ['grupa', 'group']], ['Skała', ['skala', 'crag']], ['Sektor', ['sektor', 'sector']],
  ['Nazwa', ['nazwa', 'name', 'route', 'droga']], ['Typ', ['typ', 'type']], ['Wycena', ['wycena', 'grade']],
  ['Skala_wycen', ['skala_wycen', 'grade_system', 'system']], ['Długość', ['dlugosc', 'length', 'length_m']], ['Przeloty', ['przeloty', 'bolts']],
  ['Autor', ['autor', 'author']], ['Rok', ['rok', 'year']], ['Opis', ['opis', 'description']],
  ['Lat', ['lat', 'latitude', 'szerokosc']], ['Lng', ['lng', 'lon', 'longitude', 'dlugosc_geograficzna']], ['Przybliżone', ['przyblizone', 'przyblizona', 'approx', 'approximate']],
  ['Opis_skały', ['opis_skaly', 'crag_description']], ['Dojście', ['dojscie', 'approach']],
  ['ID_skały', ['id_skaly', 'crag_id', 'crag_key', 'key_skaly']], ['ID_drogi', ['id_drogi', 'route_id', 'key']],
];
const CANON = new Map(TEMPLATE.flatMap(([name, keys]) => keys.map((k) => [k, name])));
const canonical = (h) => CANON.get(headerKey(h)) ?? h.trim();

const problems = [];
const files = existsSync(join(ROOT, 'baza')) ? readdirSync(join(ROOT, 'baza')).filter((f) => f.toLowerCase().endsWith('.csv')).sort() : [];

// Every row as { file, line, cells: Map<column, value> }, columns by their template names.
const tables = files.map((f) => {
  const [head = [], ...body] = parseCsv(readFileSync(join(ROOT, 'baza', f), 'utf8'));
  const cols = head.map(canonical);
  for (const need of ['Region', 'Rejon', 'Skała', 'Nazwa', 'Wycena']) if (!cols.includes(need)) problems.push(`${f}: brak kolumny ${need}`);
  return { f, cols, rows: body.map((r, i) => ({ file: f, line: i + 2, cells: new Map(cols.map((c, j) => [c, (r[j] ?? '').trim()])) })) };
});
if (problems.length) fail();
const rows = tables.flatMap((t) => t.rows);
const get = (r, c) => r.cells.get(c) ?? '';

// ---- 0. Rows ---------------------------------------------------------------------------------------------------------
// The same rules as the app's import (src/domain/flatImport.ts and grades.ts in the app's repository); keep them in step.
const TYPES = new Set(['', 'sport', 'droga', 'route', 'multipitch', 'wielowyciag']);
const LADDER = {
  kr: ['III', 'IV', 'V', 'V+', 'VI', 'VI.1', 'VI.1+', 'VI.2', 'VI.2+', 'VI.3', 'VI.3+', 'VI.4', 'VI.4+', 'VI.5', 'VI.5+', 'VI.6', 'VI.6+', 'VI.7', 'VI.7+', 'VI.8', 'VI.8+'],
  uiaa: ['III', 'IV', 'V', 'V+', 'VI', 'VI+', 'VII-', 'VII', 'VII+', 'VIII-', 'VIII-', 'VIII', 'VIII+', 'IX-', 'IX', 'IX+', 'X-', 'X', 'X+', 'XI-', 'XI'],
  fr: ['3', '4a', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+'],
};
const gradeNorm = (g) => g.trim().replace(/\s+/g, '').toUpperCase();
const onLadder = (g, sys) => LADDER[sys].some((x) => gradeNorm(x) === g);
/** Whether the app can read grade `label` in system `sys` (the app's parseGrade: "VI.4/4+" by its first part, "VI-" a step lower…). */
function gradeKnown(label, sys) {
  const g = gradeNorm(label);
  if (!g) return false;
  if (onLadder(g, sys)) return true;
  const first = g.replace(/\?+$/, '').split('/')[0];
  if (!first) return false;
  if (onLadder(first, sys)) return true;
  const bare = first.replace(/[+-]$/, '');
  if ((sys === 'kr' || sys === 'uiaa') && (bare === 'I' || bare === 'II')) return true;
  return /[+-]$/.test(first) && onLadder(bare, sys);
}
for (const r of rows) {
  const where = `${r.file}, wiersz ${r.line}${get(r, 'Nazwa') ? ` (${get(r, 'Nazwa')})` : ''}`;
  if (fold(get(r, 'Typ')) === 'boulder') { problems.push(`${where}: typ boulder – aplikacja nie ma boulderów, usuń ten wiersz`); continue; }
  const empty = ['Region', 'Rejon', 'Skała', 'Nazwa', 'Wycena'].filter((c) => !get(r, c));
  if (empty.length) { problems.push(`${where}: brak ${empty.join(', ')}`); continue; }
  if (!TYPES.has(fold(get(r, 'Typ')))) { problems.push(`${where}: nieznany typ „${get(r, 'Typ')}” (wpisz droga albo wielowyciąg, albo zostaw puste)`); continue; }
  const sys = (get(r, 'Skala_wycen') || 'kr').toLowerCase();
  if (!LADDER[sys]) { problems.push(`${where}: nieznana skala wycen „${get(r, 'Skala_wycen')}” (kr, uiaa albo fr)`); continue; }
  if (!gradeKnown(get(r, 'Wycena'), sys)) problems.push(`${where}: aplikacja nie rozpozna wyceny „${get(r, 'Wycena')}” w skali ${sys}`);
}
if (problems.length) fail();

// ---- 1. Numbers --------------------------------------------------------------------------------------------------
const memoryPath = join(ROOT, 'narzedzia', 'numery.json');
const memory = existsSync(memoryPath) ? JSON.parse(readFileSync(memoryPath, 'utf8')) : { crags: {}, routes: {} };
const cragKey = (r) => [get(r, 'Region'), get(r, 'Rejon'), get(r, 'Skała')].map(fold).join('|');
const routeKey = (r, nth) => [cragKey(r), fold(get(r, 'Sektor')), fold(get(r, 'Nazwa')), nth].join('|');
const number = (id, prefix) => { const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id); return m ? Number(m[1]) : 0; };
let nextCrag = 1 + Math.max(0, ...Object.values(memory.crags).map((id) => number(id, 'sk')), ...rows.map((r) => number(get(r, 'ID_skały'), 'sk')));
let nextRoute = 1 + Math.max(0, ...Object.values(memory.routes).map((id) => number(id, 'dr')), ...rows.map((r) => number(get(r, 'ID_drogi'), 'dr')));
const pad = (n) => String(n).padStart(4, '0');

// Crags: a number written in the file wins; a crag without one takes the number its other rows or the memory have, else a new one.
const cragIdOf = new Map();
for (const r of rows) { const id = get(r, 'ID_skały'); if (id && !cragIdOf.has(cragKey(r))) cragIdOf.set(cragKey(r), id); }
const cragOfId = new Map();
for (const r of rows) {
  const k = cragKey(r);
  if (get(r, 'ID_skały') && cragIdOf.get(k) !== get(r, 'ID_skały')) problems.push(`${r.file}, wiersz ${r.line}: skała ${get(r, 'Skała')} ma w różnych wierszach różne numery (${cragIdOf.get(k)}, ${get(r, 'ID_skały')})`);
  let id = get(r, 'ID_skały') || cragIdOf.get(k) || memory.crags[k];
  if (!id) { id = `sk-${pad(nextCrag++)}`; }
  cragIdOf.set(k, id);
  if (!get(r, 'ID_skały')) { r.cells.set('ID_skały', id); r.filled = true; }
  const seen = cragOfId.get(id);
  if (seen && seen.k !== k) problems.push(`${r.file}, wiersz ${r.line}: numer ${id} ma już skała ${seen.name} (${seen.file}, wiersz ${seen.line})`);
  if (!seen) cragOfId.set(id, { k, name: get(r, 'Skała'), file: r.file, line: r.line });
}

// Routes: the same, by crag, sector and name (the n-th route of the same name on one wall keeps its own number).
const nth = new Map();
const routeOfId = new Map();
for (const r of rows) {
  const base = routeKey(r, '');
  const n = (nth.get(base) ?? 0) + 1;
  nth.set(base, n);
  const k = routeKey(r, n);
  let id = get(r, 'ID_drogi');
  if (!id) {
    const remembered = memory.routes[k];
    id = remembered && !routeOfId.has(remembered) ? remembered : `dr-${pad(nextRoute++)}`;
    r.cells.set('ID_drogi', id); r.filled = true;
  }
  const seen = routeOfId.get(id);
  if (seen) problems.push(`${r.file}, wiersz ${r.line}: numer ${id} ma już droga ${seen.name} (${seen.file}, wiersz ${seen.line})`);
  else routeOfId.set(id, { k, name: get(r, 'Nazwa'), file: r.file, line: r.line });
}

// ---- 2. Packs ------------------------------------------------------------------------------------------------------
const packs = new Map();
const cragPack = new Map();
for (const r of rows) {
  const region = get(r, 'Region'); const area = get(r, 'Rejon'); const group = get(r, 'Grupa').split(SEP)[0].trim();
  const name = group || `${area} – pozostałe skały`;
  const id = slug(`${area} ${group || 'pozostale'}`);
  const crag = get(r, 'ID_skały');
  const before = cragPack.get(crag);
  if (before && before !== id) problems.push(`${r.file}, wiersz ${r.line}: skała ${get(r, 'Skała')} jest w dwóch grupach; jedna skała = jedna grupa`);
  cragPack.set(crag, id);
  const p = packs.get(id) ?? { id, name, region, area, rows: [], crags: new Set(), lats: [], lngs: [] };
  if (p.region !== region || p.area !== area) problems.push(`${r.file}, wiersz ${r.line}: grupa ${name} jest w dwóch rejonach`);
  p.rows.push(r); p.crags.add(crag);
  const lat = Number(get(r, 'Lat').replace(',', '.')); const lng = Number(get(r, 'Lng').replace(',', '.'));
  if (get(r, 'Lat') && get(r, 'Lng') && Number.isFinite(lat) && Number.isFinite(lng)) { p.lats.push(lat); p.lngs.push(lng); }
  packs.set(id, p);
}
if (problems.length) fail();

// ---- 3. Write --------------------------------------------------------------------------------------------------------
// The base files get the numbers they lacked (the user's column order is kept; missing ID columns are added at the end).
for (const t of tables) {
  if (!t.rows.some((r) => r.filled)) continue;
  const cols = [...t.cols, ...['ID_skały', 'ID_drogi'].filter((c) => !t.cols.includes(c))];
  writeFileSync(join(ROOT, 'baza', t.f), toCsv([cols, ...t.rows.map((r) => cols.map((c) => get(r, c)))]));
}

const extra = [...new Set(tables.flatMap((t) => t.cols))].filter((c) => !TEMPLATE.some(([name]) => name === c));
const header = [...TEMPLATE.map(([name]) => name), ...extra];
const indexPath = join(ROOT, 'index.json');
const old = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { packs: [] };
const oldById = new Map(old.packs.map((p) => [p.id, p]));
rmSync(join(ROOT, 'paczki'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'paczki'), { recursive: true });
const out = [...packs.values()].sort((a, b) => [a.region, a.area, a.name].join('|').localeCompare([b.region, b.area, b.name].join('|'), 'pl')).map((p) => {
  const text = toCsv([header, ...p.rows.map((r) => header.map((c) => get(r, c)))]);
  const file = `paczki/${p.id}.csv`;
  writeFileSync(join(ROOT, file), text);
  const sha1 = createHash('sha1').update(text).digest('hex');
  const prev = oldById.get(p.id);
  const version = prev ? (prev.sha1 === sha1 ? prev.version : prev.version + 1) : 1;
  const bbox = p.lats.length ? [Math.min(...p.lngs), Math.min(...p.lats), Math.max(...p.lngs), Math.max(...p.lats)] : null;
  return { id: p.id, name: p.name, region: p.region, area: p.area, crags: p.crags.size, routes: p.rows.length, version, sha1, bytes: Buffer.byteLength(text), file, bbox };
});
const changed = JSON.stringify(out) !== JSON.stringify(old.packs);
writeFileSync(indexPath, JSON.stringify({ format: 1, updated: changed ? new Date().toISOString() : old.updated ?? new Date().toISOString(), packs: out }, null, 2) + '\n');

// Memory of numbers: everything numbered so far stays (also rows deleted from the base, so a row put back gets its number again).
for (const [k, id] of cragIdOf) memory.crags[k] = id;
for (const [id, v] of routeOfId) memory.routes[v.k] = id;
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(memoryPath, JSON.stringify({ crags: sorted(memory.crags), routes: sorted(memory.routes) }, null, 1) + '\n');
writeFileSync(join(ROOT, 'NASTEPNE_NUMERY.txt'),
  `Następne wolne numery (gdybyś chciał wpisać numer sam; puste komórki automat wypełni sam):\r\nskała: sk-${pad(nextCrag)}\r\ndroga: dr-${pad(nextRoute)}\r\n`);

const filled = rows.filter((r) => r.filled).length;
if (filled) console.log(`Nadane numery: ${filled} wierszy.`);
for (const p of out) console.log(`${p.id}: ${p.name} (${p.region} › ${p.area}) skał ${p.crags}, dróg ${p.routes}, wersja ${p.version}`);

function fail() {
  const more = problems.length > 40 ? `\n… i jeszcze ${problems.length - 40}` : '';
  console.error(`Paczki NIE zostały zbudowane (problemów: ${problems.length}):\n${problems.slice(0, 40).join('\n')}${more}`);
  process.exit(1);
}
