#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node tools/generate_vocab_rebuild_sql.js OUTPUT_DIRECTORY');
fs.mkdirSync(outputDirectory, { recursive: true });

const payload = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8'));
const words = Array.isArray(payload) ? payload : (payload.words || []);
const report = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'vocab-rebuild-report-20260812.json'), 'utf8'));
const correctedIds = new Set(report.corrections.map(row => Number(row.id)));
const contentPublicationIds = new Set([...correctedIds, 6172, 6173, 6177]);

const metadataFields = [
  ['id', 'integer'],
  ['difficulty', 'text'],
  ['frequency_rank', 'integer'],
  ['frequency_source', 'text'],
  ['verification_status', 'text'],
  ['source', 'text'],
  ['learning_track', 'text'],
  ['specialist_book', 'text'],
  ['content_status', 'text'],
  ['naturalness_status', 'text'],
  ['corpus_frequency', 'bigint'],
  ['news_frequency', 'integer'],
  ['news_document_count', 'integer'],
  ['news_category_count', 'integer'],
  ['corpus_snapshot', 'text'],
  ['curation_reason', 'text']
];

const correctionFields = [
  ['id', 'integer'],
  ['zh', 'text'],
  ['ro', 'text'],
  ['ipa', 'text'],
  ['syls', 'text[]'],
  ['stress', 'integer[]'],
  ['hint', 'text'],
  ['cat', 'text'],
  ['example_ro', 'text'],
  ['example_zh', 'text'],
  ['topic', 'text'],
  ['part_of_speech', 'text'],
  ['unit_type', 'text'],
  ['grammar_data', 'jsonb'],
  ['verification_status', 'text'],
  ['source', 'text']
];

function project(row, fields) {
  return Object.fromEntries(fields.map(([field]) => [field, row[field] ?? null]));
}

function buildUpdateSql(rows, fields, label) {
  const definition = fields.map(([field, type]) => `${field} ${type}`).join(', ');
  const assignments = fields
    .filter(([field]) => field !== 'id')
    .map(([field]) => `${field} = incoming.${field}`)
    .join(',\n    ');
  const ids = rows.map(row => Number(row.id));
  return `begin;
with incoming as (
  select * from jsonb_to_recordset($vocab$${JSON.stringify(rows.map(row => project(row, fields)))}$vocab$::jsonb)
    as row(${definition})
), updated as (
  update public.words as words
  set ${assignments}
  from incoming
  where words.id = incoming.id
  returning words.id
)
select '${label}' as batch, count(*)::integer as updated_rows,
       min(id)::integer as first_id, max(id)::integer as last_id
from updated;
commit;
-- Expected stable ids: ${ids.length}; range ${Math.min(...ids)}-${Math.max(...ids)}
`;
}

const chunkSize = 75;
for (let start = 0, index = 1; start < words.length; start += chunkSize, index += 1) {
  const rows = words.slice(start, start + chunkSize);
  const filename = `metadata-${String(index).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(outputDirectory, filename), buildUpdateSql(rows, metadataFields, filename));
}

const corrections = words.filter(word => contentPublicationIds.has(Number(word.id)));
fs.writeFileSync(
  path.join(outputDirectory, 'corrections.sql'),
  buildUpdateSql(corrections, correctionFields, 'corrections.sql')
);

const manifest = {
  totalWords: words.length,
  metadataChunks: Math.ceil(words.length / chunkSize),
  reviewedCorrections: correctedIds.size,
  contentRows: corrections.length,
  files: fs.readdirSync(outputDirectory).filter(file => file.endsWith('.sql')).sort()
};
fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
