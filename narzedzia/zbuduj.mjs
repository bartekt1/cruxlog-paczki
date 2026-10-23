// Dzieli bazę skał (pliki CSV w baza/, wzór Cruxlog) na paczki: jedna paczka = jedna grupa skał (pierwszy poziom kolumny
// Grupa), skały bez grupy trafiają do paczki "<Rejon> – pozostałe skały". Zapisuje paczki/<id>.csv i spis index.json,
// który czyta aplikacja. Wersja paczki rośnie tylko wtedy, gdy zmieniła się jej zawartość.
// Uruchomienie: node narzedzia/zbuduj.mjs   (bez dodatkowych bibliotek; Node 18+)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SEP = '›';

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().trim();
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

const NAMES = { region: ['region'], area: ['rejon', 'area'], group: ['grupa', 'group'], crag: ['skala', 'crag'], cragId: ['id_skaly', 'crag_id', 'crag_key', 'key_skaly'], lat: ['lat', 'latitude', 'szerokosc'], lng: ['lng', 'lon', 'longitude', 'dlugosc_geograficzna'] };

const files = existsSync(join(ROOT, 'baza')) ? readdirSync(join(ROOT, 'baza')).filter((f) => f.toLowerCase().endsWith('.csv')).sort() : [];
const packs = new Map();
const cragPack = new Map();
const problems = [];
let header = null;
for (const f of files) {
  const [head, ...body] = parseCsv(readFileSync(join(ROOT, 'baza', f), 'utf8'));
  const col = Object.fromEntries(Object.entries(NAMES).map(([k, names]) => [k, head.findIndex((h) => names.includes(headerKey(h)))]));
  for (const k of ['region', 'area', 'crag']) if (col[k] < 0) problems.push(`${f}: brak kolumny ${k === 'area' ? 'Rejon' : k === 'crag' ? 'Skała' : 'Region'}`);
  if (problems.length) continue;
  if (header && header.join(';') !== head.join(';')) problems.push(`${f}: inne nagłówki niż w ${files[0]} (wszystkie pliki bazy muszą mieć te same kolumny)`);
  header = header ?? head;
  body.forEach((r, i) => {
    const get = (k) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
    const region = get('region'); const area = get('area'); const group = get('group').split(SEP)[0].trim();
    const name = group || `${area} – pozostałe skały`;
    const id = slug(`${area} ${group || 'pozostale'}`);
    const cragKey = get('cragId') || slug([region, area, get('group'), get('crag')].join(' '));
    const before = cragPack.get(cragKey);
    if (before && before !== id) problems.push(`${f}, wiersz ${i + 2}: skała ${get('crag')} jest w dwóch grupach (${before}, ${id}); jedna skała = jedna paczka`);
    cragPack.set(cragKey, id);
    const p = packs.get(id) ?? { id, name, region, area, rows: [], crags: new Set(), lats: [], lngs: [] };
    if (p.region !== region || p.area !== area) problems.push(`${f}, wiersz ${i + 2}: grupa ${name} jest w dwóch rejonach`);
    p.rows.push(r); p.crags.add(cragKey);
    const lat = Number(get('lat').replace(',', '.')); const lng = Number(get('lng').replace(',', '.'));
    if (get('lat') && get('lng') && Number.isFinite(lat) && Number.isFinite(lng)) { p.lats.push(lat); p.lngs.push(lng); }
    packs.set(id, p);
  });
}
if (problems.length) {
  console.error(`Paczki NIE zostały zbudowane:\n${problems.slice(0, 30).join('\n')}`);
  process.exit(1);
}

const indexPath = join(ROOT, 'index.json');
const old = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { packs: [] };
const oldById = new Map(old.packs.map((p) => [p.id, p]));
rmSync(join(ROOT, 'paczki'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'paczki'), { recursive: true });
const out = [...packs.values()].sort((a, b) => [a.region, a.area, a.name].join('|').localeCompare([b.region, b.area, b.name].join('|'), 'pl')).map((p) => {
  const text = toCsv([header, ...p.rows]);
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
for (const p of out) console.log(`${p.id}: ${p.name} (${p.region} › ${p.area}) skał ${p.crags}, dróg ${p.routes}, wersja ${p.version}`);
