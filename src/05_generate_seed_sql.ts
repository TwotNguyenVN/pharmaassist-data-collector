import { logInfo, logError, logWarn } from './utils/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');
const NORMALIZED_DIR = path.join(ROOT_DIR, 'data/normalized');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data/output');
const SQL_DIR = path.join(OUTPUT_DIR, 'sql');

// Required fields mapping for validation
const REQUIRED_FIELDS: Record<string, string[]> = {
  countries: ['country_code', 'country_name'],
  brands: ['brand_code', 'brand_name'],
  manufacturers: ['manufacturer_code', 'manufacturer_name'],
  medicine_units: ['unit_code', 'unit_name'],
  dosage_forms: ['dosage_form_code', 'dosage_form_name'],
  product_categories: ['category_code', 'category_name'],
  category_closures: ['ancestor_code', 'descendant_code', 'depth'],
  active_ingredients: ['ingredient_code', 'ingredient_name'],
  products: ['product_code', 'product_name'],
  product_variants: ['variant_code', 'product_code', 'unit_name'],
  product_images: ['product_code', 'image_url'],
  product_prices: ['variant_code', 'price'],
  medicines: ['product_code'],
  medicine_ingredients: ['product_code', 'ingredient_code'],
  product_documents: ['product_code', 'document_type', 'title', 'content']
};

// Summary counters
const generatedCounts: Record<string, number> = {};
const skippedCounts: Record<string, number> = {};

/**
 * Standard CSV Parser that handles double quotes, commas, and embedded newlines.
 */
function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',') {
      if (inQuotes) {
        currentField += ',';
      } else {
        currentRow.push(currentField);
        currentField = '';
      }
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        currentField += char;
      } else {
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0) {
          if (currentRow.length > 1 || currentRow[0] !== '') {
            rows.push(currentRow);
          }
        }
        currentRow = [];
        if (char === '\r' && nextChar === '\n') {
          i++; // skip \n
        }
      }
    } else {
      currentField += char;
    }
  }
  
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  
  if (rows.length === 0) return [];
  
  const headers = rows[0];
  const records: Record<string, string>[] = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = row[j] || '';
    }
    records.push(record);
  }
  
  return records;
}

/**
 * Safely reads a CSV file and parses it. Returns empty array if file is missing.
 */
function readCsvFile(filename: string): Record<string, string>[] {
  const fullPath = path.join(NORMALIZED_DIR, filename);
  const baseName = path.basename(filename, '.csv');
  if (!fs.existsSync(fullPath)) {
    logWarn(`CSV File not found: ${filename}, skipping.`);
    return [];
  }
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return parseCsv(content);
  } catch (err) {
    logWarn(`Failed to read/parse CSV file: ${filename}, Error: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Escape single quotes for PostgreSQL string type
 */
function escapeSqlString(val: string | null | undefined): string {
  if (val === undefined || val === null || val === 'null' || val.trim() === '') {
    return 'NULL';
  }
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * Escape PostgreSQL number type
 */
function escapeSqlNumber(val: string | null | undefined): string {
  if (val === undefined || val === null || val === 'null' || val === '') {
    return 'NULL';
  }
  const num = Number(val);
  return isNaN(num) ? 'NULL' : String(num);
}

/**
 * Escape PostgreSQL boolean type
 */
function escapeSqlBoolean(val: string | null | undefined): string {
  if (val === undefined || val === null || val === 'null' || val === '') {
    return 'NULL';
  }
  const str = String(val).toLowerCase().trim();
  if (str === 'true' || str === 't' || str === '1') return 'true';
  if (str === 'false' || str === 'f' || str === '0') return 'false';
  return 'NULL';
}

/**
 * Validates if row contains all required fields. Logs warning and returns false if validation fails.
 */
function validateRequiredFields(tableName: string, row: Record<string, string>, index: number): boolean {
  const required = REQUIRED_FIELDS[tableName] || [];
  for (const field of required) {
    const val = row[field];
    if (val === undefined || val === null || val === 'null' || val.trim() === '') {
      logWarn(`[Row ${index + 1}] Missing required field '${field}' in table '${tableName}'. Skipping row.`);
      skippedCounts[tableName] = (skippedCounts[tableName] || 0) + 1;
      return false;
    }
  }
  return true;
}

/**
 * Generates SQL comments header
 */
function getSqlHeader(): string {
  return `-- =========================================================================\n` +
         `-- DỮ LIỆU THAM KHẢO PHỤC VỤ ĐỒ ÁN PHARMAASSIST\n` +
         `-- TUYỆT ĐỐI KHÔNG SỬ DỤNG CHO MỤC ĐÍCH TƯ VẤN Y TẾ\n` +
         `-- KHÔNG THỂ THAY THẾ DƯỢC SĨ/BÁC SĨ HOẶC CHUYÊN GIA Y TẾ\n` +
         `-- Generated at: ${new Date().toLocaleString('vi-VN', { hour12: false })}\n` +
         `-- =========================================================================\n\n`;
}

async function main(): Promise<void> {
  logInfo('=== Step 05: Generate Seed SQL ===');
  
  // Create output directories
  fs.mkdirSync(SQL_DIR, { recursive: true });

  // 1. Read CSV Files
  const countriesCsv = readCsvFile('countries.csv');
  const brandsCsv = readCsvFile('brands.csv');
  const manufacturersCsv = readCsvFile('manufacturers.csv');
  const medicineUnitsCsv = readCsvFile('medicine_units.csv');
  const dosageFormsCsv = readCsvFile('dosage_forms.csv');
  const productCategoriesCsv = readCsvFile('product_categories.csv');
  const categoryClosuresCsv = readCsvFile('category_closures.csv');
  const productsCsv = readCsvFile('products.csv');
  const productVariantsCsv = readCsvFile('product_variants.csv');
  const productImagesCsv = readCsvFile('product_images.csv');
  const productPricesCsv = readCsvFile('product_prices.csv');
  const medicinesCsv = readCsvFile('medicines.csv');
  const activeIngredientsCsv = readCsvFile('active_ingredients.csv');
  const medicineIngredientsCsv = readCsvFile('medicine_ingredients.csv');
  const productDocumentsCsv = readCsvFile('product_documents.csv');

  // Initialize generatedCounts
  const tables = [
    'countries', 'brands', 'manufacturers', 'medicine_units', 'dosage_forms',
    'product_categories', 'category_closures', 'products', 'product_variants',
    'product_images', 'product_prices', 'medicines', 'active_ingredients',
    'medicine_ingredients', 'product_documents'
  ];
  for (const t of tables) {
    generatedCounts[t] = 0;
    skippedCounts[t] = 0;
  }

  // File 1: Master Data SQL
  let masterSql = getSqlHeader();
  masterSql += `BEGIN;\n\n`;

  // 1.1 Countries
  masterSql += `-- 1. Countries\n`;
  countriesCsv.forEach((row, i) => {
    if (validateRequiredFields('countries', row, i)) {
      masterSql += `INSERT INTO countries (country_code, country_name, country_slug, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.country_code)},\n` +
        `  ${escapeSqlString(row.country_name)},\n` +
        `  ${escapeSqlString(row.country_slug)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['countries']++;
    }
  });
  masterSql += `\n`;

  // 1.2 Brands
  masterSql += `-- 2. Brands\n`;
  brandsCsv.forEach((row, i) => {
    if (validateRequiredFields('brands', row, i)) {
      masterSql += `INSERT INTO brands (brand_code, brand_name, brand_slug, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.brand_code)},\n` +
        `  ${escapeSqlString(row.brand_name)},\n` +
        `  ${escapeSqlString(row.brand_slug)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['brands']++;
    }
  });
  masterSql += `\n`;

  // 1.3 Manufacturers
  masterSql += `-- 3. Manufacturers\n`;
  manufacturersCsv.forEach((row, i) => {
    if (validateRequiredFields('manufacturers', row, i)) {
      masterSql += `INSERT INTO manufacturers (manufacturer_code, manufacturer_name, manufacturer_slug, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.manufacturer_code)},\n` +
        `  ${escapeSqlString(row.manufacturer_name)},\n` +
        `  ${escapeSqlString(row.manufacturer_slug)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['manufacturers']++;
    }
  });
  masterSql += `\n`;

  // 1.4 Medicine Units
  masterSql += `-- 4. Medicine Units\n`;
  medicineUnitsCsv.forEach((row, i) => {
    if (validateRequiredFields('medicine_units', row, i)) {
      masterSql += `INSERT INTO medicine_units (unit_code, unit_name, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.unit_code)},\n` +
        `  ${escapeSqlString(row.unit_name)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['medicine_units']++;
    }
  });
  masterSql += `\n`;

  // 1.5 Dosage Forms
  masterSql += `-- 5. Dosage Forms\n`;
  dosageFormsCsv.forEach((row, i) => {
    if (validateRequiredFields('dosage_forms', row, i)) {
      masterSql += `INSERT INTO dosage_forms (dosage_form_code, dosage_form_name, dosage_form_slug, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.dosage_form_code)},\n` +
        `  ${escapeSqlString(row.dosage_form_name)},\n` +
        `  ${escapeSqlString(row.dosage_form_slug)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['dosage_forms']++;
    }
  });
  masterSql += `\n`;

  // 1.6 Product Categories
  masterSql += `-- 6. Product Categories\n`;
  productCategoriesCsv.forEach((row, i) => {
    if (validateRequiredFields('product_categories', row, i)) {
      masterSql += `INSERT INTO product_categories (category_code, parent_category_code, category_name, category_slug, level, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.category_code)},\n` +
        `  ${escapeSqlString(row.parent_category_code)},\n` +
        `  ${escapeSqlString(row.category_name)},\n` +
        `  ${escapeSqlString(row.category_slug)},\n` +
        `  ${escapeSqlNumber(row.level)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['product_categories']++;
    }
  });
  masterSql += `\n`;

  // 1.7 Category Closures
  masterSql += `-- 7. Category Closures\n`;
  categoryClosuresCsv.forEach((row, i) => {
    if (validateRequiredFields('category_closures', row, i)) {
      masterSql += `INSERT INTO category_closures (ancestor_code, descendant_code, depth, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.ancestor_code)},\n` +
        `  ${escapeSqlString(row.descendant_code)},\n` +
        `  ${escapeSqlNumber(row.depth)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['category_closures']++;
    }
  });
  masterSql += `\n`;

  // 1.8 Active Ingredients
  masterSql += `-- 8. Active Ingredients\n`;
  activeIngredientsCsv.forEach((row, i) => {
    if (validateRequiredFields('active_ingredients', row, i)) {
      masterSql += `INSERT INTO active_ingredients (ingredient_code, ingredient_name, ingredient_slug, description, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
        `  ${escapeSqlString(row.ingredient_code)},\n` +
        `  ${escapeSqlString(row.ingredient_name)},\n` +
        `  ${escapeSqlString(row.ingredient_slug)},\n` +
        `  ${escapeSqlString(row.description)},\n` +
        `  ${escapeSqlString(row.source_name)},\n` +
        `  ${escapeSqlString(row.source_url)},\n` +
        `  ${escapeSqlString(row.source_note)},\n` +
        `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
        `  ${escapeSqlString(row.collected_at)}\n` +
        `) ON CONFLICT DO NOTHING;\n`;
      generatedCounts['active_ingredients']++;
    }
  });

  masterSql += `\nCOMMIT;\n`;

  const masterPath = path.join(SQL_DIR, '001_master_data.sql');
  fs.writeFileSync(masterPath, masterSql, 'utf-8');
  logInfo(`Generated Master Data SQL: ${masterPath}`);

  // 2. Generate Product Data SQL Batches
  const BATCH_SIZE = 500;
  const totalProducts = productsCsv.length;
  const numBatches = Math.ceil(totalProducts / BATCH_SIZE);
  const batchPaths: string[] = [];

  for (let b = 0; b < numBatches; b++) {
    const batchStart = b * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalProducts);
    const batchProducts = productsCsv.slice(batchStart, batchEnd);
    const batchProductCodes = new Set(batchProducts.map(p => p.product_code).filter(Boolean));

    let batchSql = getSqlHeader();
    batchSql += `BEGIN;\n\n`;

    // 2.1 Products
    batchSql += `-- 1. Products (Batch ${b + 1})\n`;
    batchProducts.forEach((row, i) => {
      const globalIndex = batchStart + i;
      if (validateRequiredFields('products', row, globalIndex)) {
        batchSql += `INSERT INTO products (product_code, category_code, brand_code, manufacturer_code, country_code, product_name, product_slug, product_type, short_description, rating_average, review_count, base_unit_code, price_status, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.category_code)},\n` +
          `  ${escapeSqlString(row.brand_code)},\n` +
          `  ${escapeSqlString(row.manufacturer_code)},\n` +
          `  ${escapeSqlString(row.country_code)},\n` +
          `  ${escapeSqlString(row.product_name)},\n` +
          `  ${escapeSqlString(row.product_slug)},\n` +
          `  ${escapeSqlString(row.product_type)},\n` +
          `  ${escapeSqlString(row.short_description)},\n` +
          `  ${escapeSqlNumber(row.rating_average)},\n` +
          `  ${escapeSqlNumber(row.review_count)},\n` +
          `  ${escapeSqlString(row.base_unit_code)},\n` +
          `  ${escapeSqlString(row.price_status)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['products']++;
      }
    });
    batchSql += `\n`;

    // 2.2 Product Variants
    batchSql += `-- 2. Product Variants (Batch ${b + 1})\n`;
    const batchVariants = productVariantsCsv.filter(v => batchProductCodes.has(v.product_code));
    const batchVariantCodes = new Set(batchVariants.map(v => v.variant_code).filter(Boolean));

    batchVariants.forEach((row, i) => {
      if (validateRequiredFields('product_variants', row, i)) {
        batchSql += `INSERT INTO product_variants (variant_code, product_code, sku, unit_code, unit_name, packaging_size, is_default, is_sell_default, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.variant_code)},\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.sku)},\n` +
          `  ${escapeSqlString(row.unit_code)},\n` +
          `  ${escapeSqlString(row.unit_name)},\n` +
          `  ${escapeSqlString(row.packaging_size)},\n` +
          `  ${escapeSqlBoolean(row.is_default)},\n` +
          `  ${escapeSqlBoolean(row.is_sell_default)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['product_variants']++;
      }
    });
    batchSql += `\n`;

    // 2.3 Product Images
    batchSql += `-- 3. Product Images (Batch ${b + 1})\n`;
    const batchImages = productImagesCsv.filter(img => batchProductCodes.has(img.product_code));
    batchImages.forEach((row, i) => {
      if (validateRequiredFields('product_images', row, i)) {
        batchSql += `INSERT INTO product_images (product_code, image_url, is_primary, display_order, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.image_url)},\n` +
          `  ${escapeSqlBoolean(row.is_primary)},\n` +
          `  ${escapeSqlNumber(row.display_order)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['product_images']++;
      }
    });
    batchSql += `\n`;

    // 2.4 Product Prices
    batchSql += `-- 4. Product Prices (Batch ${b + 1})\n`;
    const batchPrices = productPricesCsv.filter(price => batchVariantCodes.has(price.variant_code));
    batchPrices.forEach((row, i) => {
      if (validateRequiredFields('product_prices', row, i)) {
        batchSql += `INSERT INTO product_prices (variant_code, unit_code, price, currency, is_default, conversion_factor, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.variant_code)},\n` +
          `  ${escapeSqlString(row.unit_code)},\n` +
          `  ${escapeSqlNumber(row.price)},\n` +
          `  ${escapeSqlString(row.currency)},\n` +
          `  ${escapeSqlBoolean(row.is_default)},\n` +
          `  ${escapeSqlNumber(row.conversion_factor)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['product_prices']++;
      }
    });
    batchSql += `\n`;

    // 2.5 Medicines
    batchSql += `-- 5. Medicines (Batch ${b + 1})\n`;
    const batchMedicines = medicinesCsv.filter(med => batchProductCodes.has(med.product_code));
    batchMedicines.forEach((row, i) => {
      if (validateRequiredFields('medicines', row, i)) {
        batchSql += `INSERT INTO medicines (product_code, registration_number, dosage_form_code, requires_prescription, shelf_life_months, temperature_condition, light_condition, humidity_condition, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.registration_number)},\n` +
          `  ${escapeSqlString(row.dosage_form_code)},\n` +
          `  ${escapeSqlBoolean(row.requires_prescription)},\n` +
          `  ${escapeSqlNumber(row.shelf_life_months)},\n` +
          `  ${escapeSqlString(row.temperature_condition)},\n` +
          `  ${escapeSqlString(row.light_condition)},\n` +
          `  ${escapeSqlString(row.humidity_condition)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['medicines']++;
      }
    });
    batchSql += `\n`;

    // 2.6 Medicine Ingredients
    batchSql += `-- 6. Medicine Ingredients (Batch ${b + 1})\n`;
    const batchMedIngredients = medicineIngredientsCsv.filter(mi => batchProductCodes.has(mi.product_code));
    batchMedIngredients.forEach((row, i) => {
      if (validateRequiredFields('medicine_ingredients', row, i)) {
        batchSql += `INSERT INTO medicine_ingredients (product_code, ingredient_code, strength_value, strength_unit, raw_text, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.ingredient_code)},\n` +
          `  ${escapeSqlNumber(row.strength_value)},\n` +
          `  ${escapeSqlString(row.strength_unit)},\n` +
          `  ${escapeSqlString(row.raw_text)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['medicine_ingredients']++;
      }
    });
    batchSql += `\n`;

    // 2.7 Product Documents
    batchSql += `-- 7. Product Documents (Batch ${b + 1})\n`;
    const batchDocs = productDocumentsCsv.filter(doc => batchProductCodes.has(doc.product_code));
    batchDocs.forEach((row, i) => {
      if (validateRequiredFields('product_documents', row, i)) {
        batchSql += `INSERT INTO product_documents (product_code, document_type, title, content, content_html, source_name, source_url, source_note, is_demo_data, collected_at) VALUES (\n` +
          `  ${escapeSqlString(row.product_code)},\n` +
          `  ${escapeSqlString(row.document_type)},\n` +
          `  ${escapeSqlString(row.title)},\n` +
          `  ${escapeSqlString(row.content)},\n` +
          `  ${escapeSqlString(row.content_html)},\n` +
          `  ${escapeSqlString(row.source_name)},\n` +
          `  ${escapeSqlString(row.source_url)},\n` +
          `  ${escapeSqlString(row.source_note)},\n` +
          `  ${escapeSqlBoolean(row.is_demo_data)},\n` +
          `  ${escapeSqlString(row.collected_at)}\n` +
          `) ON CONFLICT DO NOTHING;\n`;
        generatedCounts['product_documents']++;
      }
    });

    batchSql += `\nCOMMIT;\n`;

    const batchFileName = `002_products_batch_${String(b + 1).padStart(3, '0')}.sql`;
    const batchPath = path.join(SQL_DIR, batchFileName);
    fs.writeFileSync(batchPath, batchSql, 'utf-8');
    batchPaths.push(batchFileName);
    logInfo(`Generated Product Data Batch SQL: ${batchPath}`);
  }

  // 3. Generate Master seed file (seed_longchau_demo.sql)
  let mainSql = getSqlHeader();
  mainSql += `-- =========================================================================\n` +
             `-- HƯỚNG DẪN NẠP DỮ LIỆU SEED (RUN ORDER):\n` +
             `-- 1. Chạy file master data: sql/001_master_data.sql\n`;
  batchPaths.forEach((name, i) => {
    mainSql += `-- ${i + 2}. Chạy file sản phẩm batch ${i + 1}: sql/${name}\n`;
  });
  mainSql += `-- =========================================================================\n\n`;

  // Merge contents of all files into the master seed file for convenience
  mainSql += `-- === 1. IMPORT MASTER DATA ===\n`;
  mainSql += fs.readFileSync(masterPath, 'utf-8') + `\n\n`;
  
  batchPaths.forEach((name, i) => {
    const fullBatchPath = path.join(SQL_DIR, name);
    mainSql += `-- === ${i + 2}. IMPORT PRODUCT BATCH ${i + 1} (${name}) ===\n`;
    mainSql += fs.readFileSync(fullBatchPath, 'utf-8') + `\n\n`;
  });

  const mainPath = path.join(OUTPUT_DIR, 'seed_longchau_demo.sql');
  fs.writeFileSync(mainPath, mainSql, 'utf-8');
  logInfo(`Generated Consolidated Seed SQL File: ${mainPath}`);

  // 4. Output Summary
  logInfo('\n=== SQL Generation Summary ===');
  logInfo(`- Output Main Script: ${mainPath}`);
  logInfo(`- Output Batch Directory: ${SQL_DIR}`);
  logInfo('Generated records by table:');
  for (const t of tables) {
    logInfo(`  * ${t.padEnd(22)}: Generated: ${String(generatedCounts[t]).padEnd(5)} | Skipped: ${skippedCounts[t]}`);
  }
  logInfo('=== End Step 05 ===');
}

main().catch((err) => {
  logError('Fatal error in generate:sql', err);
  process.exit(1);
});
