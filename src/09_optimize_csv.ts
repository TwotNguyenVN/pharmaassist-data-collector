/**
 * 09_optimize_csv.ts
 *
 * Optimizes normalized CSV files by removing unnecessary fields
 * to reduce database storage requirements.
 *
 * Strategy A (Safe):
 * - Remove 5 metadata tracing fields from ALL tables:
 *   source_name, source_url, source_note, is_demo_data, collected_at
 * - Remove content_html from product_documents (biggest win: ~60-70 MB)
 * - Remove raw_text from medicine_ingredients
 * - Remove unit_name from product_variants (denormalized duplicate)
 * - Clean image_url JSON to plain URL string in product_images
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { createInterface } from 'readline';

// --- Configuration ---

const INPUT_DIR = join(__dirname, '..', 'data', 'normalized');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'optimized');

// Fields to remove from ALL tables
const GLOBAL_DROP_FIELDS = [
  'source_name',
  'source_url',
  'source_note',
  'is_demo_data',
  'collected_at',
];

// Per-table specific fields to remove
const TABLE_DROP_FIELDS: Record<string, string[]> = {
  'product_documents.csv': ['content_html'],
  'medicine_ingredients.csv': ['raw_text'],
  'product_variants.csv': ['unit_name'],
};

// Fields requiring transformation
const FIELD_TRANSFORMS: Record<string, Record<string, (val: string) => string>> = {
  'product_images.csv': {
    image_url: (val: string) => {
      // Extract plain URL from JSON like {"url":"https://...","alternativeText":null}
      try {
        const cleaned = val.replace(/""/g, '"');
        const parsed = JSON.parse(cleaned);
        return parsed.url || val;
      } catch {
        // If not JSON, try regex extraction
        const match = val.match(/"url"\s*:\s*"([^"]+)"/);
        return match ? match[1] : val;
      }
    },
  },
};

// --- CSV Parser (handles quoted fields with commas and newlines) ---

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// --- Processing ---

interface ProcessResult {
  file: string;
  inputRows: number;
  outputRows: number;
  droppedFields: string[];
  inputSizeMB: number;
  outputSizeMB: number;
}

async function processFile(filename: string): Promise<ProcessResult> {
  const inputPath = join(INPUT_DIR, filename);
  const outputPath = join(OUTPUT_DIR, filename);

  const inputStat = await stat(inputPath);
  const inputSizeMB = inputStat.size / (1024 * 1024);

  const tableDropFields = TABLE_DROP_FIELDS[filename] || [];
  const allDropFields = [...GLOBAL_DROP_FIELDS, ...tableDropFields];
  const transforms = FIELD_TRANSFORMS[filename] || {};

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(inputPath, { encoding: 'utf-8' });
    const writeStream = createWriteStream(outputPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });

    let headers: string[] = [];
    let keepIndices: number[] = [];
    let droppedFields: string[] = [];
    let headerFieldNames: string[] = [];
    let inputRows = 0;
    let outputRows = 0;
    let isFirstLine = true;

    // For multiline CSV field handling
    let pendingLine = '';
    let inMultilineField = false;

    const processCompleteLine = (line: string) => {
      const fields = parseCSVLine(line);

      if (isFirstLine) {
        // Process header
        headers = fields.map(f => f.trim().replace(/^\uFEFF/, '')); // Strip BOM
        headerFieldNames = [...headers];

        keepIndices = [];
        droppedFields = [];

        headers.forEach((h, i) => {
          if (allDropFields.includes(h)) {
            droppedFields.push(h);
          } else {
            keepIndices.push(i);
          }
        });

        const outputHeaders = keepIndices.map(i => headers[i]);
        writeStream.write(outputHeaders.join(',') + '\n');
        isFirstLine = false;
        return;
      }

      inputRows++;

      // Apply transforms and filter fields
      const outputFields = keepIndices.map(i => {
        let val = i < fields.length ? fields[i] : '';
        const fieldName = headerFieldNames[i];

        if (transforms[fieldName]) {
          val = transforms[fieldName](val);
        }

        return escapeCSVField(val);
      });

      writeStream.write(outputFields.join(',') + '\n');
      outputRows++;
    };

    rl.on('line', (rawLine) => {
      // Handle multiline CSV fields (content with newlines inside quotes)
      if (inMultilineField) {
        pendingLine += '\n' + rawLine;
        // Count quotes to check if field is closed
        const quoteCount = (pendingLine.match(/"/g) || []).length;
        if (quoteCount % 2 === 0) {
          inMultilineField = false;
          processCompleteLine(pendingLine);
          pendingLine = '';
        }
        return;
      }

      // Check if this line has unclosed quotes (multiline field)
      const quoteCount = (rawLine.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        inMultilineField = true;
        pendingLine = rawLine;
        return;
      }

      processCompleteLine(rawLine);
    });

    rl.on('close', async () => {
      // Process any remaining pending line
      if (pendingLine) {
        processCompleteLine(pendingLine);
      }

      writeStream.end(async () => {
        const outputStat = await stat(outputPath);
        const outputSizeMB = outputStat.size / (1024 * 1024);

        resolve({
          file: filename,
          inputRows,
          outputRows,
          droppedFields,
          inputSizeMB: Math.round(inputSizeMB * 100) / 100,
          outputSizeMB: Math.round(outputSizeMB * 100) / 100,
        });
      });
    });

    rl.on('error', reject);
    writeStream.on('error', reject);
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('📦 CSV Optimizer — Strategy A (Safe)');
  console.log('='.repeat(60));

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get all CSV files
  const files = (await readdir(INPUT_DIR)).filter(f => f.endsWith('.csv')).sort();

  console.log(`\n📂 Input:  ${INPUT_DIR}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log(`📄 Files:  ${files.length}\n`);

  const results: ProcessResult[] = [];

  for (const file of files) {
    process.stdout.write(`  Processing ${file.padEnd(30)}...`);
    const result = await processFile(file);
    results.push(result);

    const saved = result.inputSizeMB - result.outputSizeMB;
    const pct = result.inputSizeMB > 0 ? ((saved / result.inputSizeMB) * 100).toFixed(1) : '0';
    console.log(` ${result.inputSizeMB.toFixed(2)} MB → ${result.outputSizeMB.toFixed(2)} MB  (−${saved.toFixed(2)} MB / −${pct}%)`);

    if (result.droppedFields.length > 0) {
      const extra = result.droppedFields.filter(f => !GLOBAL_DROP_FIELDS.includes(f));
      if (extra.length > 0) {
        console.log(`    └── Extra dropped: ${extra.join(', ')}`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));

  const totalInputMB = results.reduce((s, r) => s + r.inputSizeMB, 0);
  const totalOutputMB = results.reduce((s, r) => s + r.outputSizeMB, 0);
  const totalSavedMB = totalInputMB - totalOutputMB;
  const totalPct = ((totalSavedMB / totalInputMB) * 100).toFixed(1);

  console.log(`\n  Total input:   ${totalInputMB.toFixed(2)} MB`);
  console.log(`  Total output:  ${totalOutputMB.toFixed(2)} MB`);
  console.log(`  Total saved:   ${totalSavedMB.toFixed(2)} MB (${totalPct}%)`);

  // Dropped fields summary
  console.log(`\n  Global dropped fields (all tables):`);
  GLOBAL_DROP_FIELDS.forEach(f => console.log(`    ❌ ${f}`));

  console.log(`\n  Per-table dropped fields:`);
  for (const [table, fields] of Object.entries(TABLE_DROP_FIELDS)) {
    fields.forEach(f => console.log(`    ❌ ${table}: ${f}`));
  }

  console.log(`\n  Transforms applied:`);
  for (const [table, transforms] of Object.entries(FIELD_TRANSFORMS)) {
    for (const field of Object.keys(transforms)) {
      console.log(`    🔧 ${table}: ${field} → extracted plain URL`);
    }
  }

  console.log('\n✅ Done! Optimized CSVs saved to:', OUTPUT_DIR);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
