import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { listFilesRecursive, ensureDir } from './utils/file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');
const OUT_DIR = path.join(ROOT_DIR, 'data/output');
const REPORT_FILE = path.join(OUT_DIR, 'data_quality_report.md');

// Severity lists for validation results
const fails: string[] = [];
const warnings: string[] = [];
const infos: string[] = [];

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
 * Safely reads a JSON file. System-level warnings/errors are pushed to proper list.
 */
function safeReadJson<T>(relativeFilePath: string, fallback: T, warnIfMissing: boolean = true): T {
  const fullPath = path.join(ROOT_DIR, relativeFilePath);
  try {
    if (!fs.existsSync(fullPath)) {
      if (warnIfMissing) {
        warnings.push(`Cảnh báo hệ thống: File \`${relativeFilePath}\` không tồn tại.`);
      }
      return fallback;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    if (warnIfMissing) {
      warnings.push(`Cảnh báo hệ thống: Không thể đọc hoặc parse file JSON \`${relativeFilePath}\`: ${(err as Error).message}`);
    }
    return fallback;
  }
}

/**
 * Safely reads a CSV file. Missing required CSV files are considered severe fails.
 */
function safeReadCsv(relativeFilePath: string): Record<string, string>[] {
  const fullPath = path.join(ROOT_DIR, relativeFilePath);
  try {
    if (!fs.existsSync(fullPath)) {
      fails.push(`Cảnh báo hệ thống: File CSV bắt buộc \`${relativeFilePath}\` không tồn tại.`);
      return [];
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return parseCsv(content);
  } catch (err) {
    fails.push(`Cảnh báo hệ thống: Không thể đọc hoặc parse file CSV \`${relativeFilePath}\`: ${(err as Error).message}`);
    return [];
  }
}

function validateContentHtml(contentHtml: string, productCode: string, docType: string): string[] {
  const errors: string[] = [];
  const whitelist = new Set([
    'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'br', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ]);
  
  // 1. Extra safety checks for raw blocks that might bypass tag parsing
  if (/<script/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<script>\`.`);
  }
  if (/<style/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<style>\`.`);
  }
  if (/<meta/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<meta>\`.`);
  }
  if (/<iframe/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<iframe>\`.`);
  }
  if (/<object/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<object>\`.`);
  }
  if (/<embed/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<embed>\`.`);
  }
  if (/<svg/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<svg>\`.`);
  }
  if (/<form/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<form>\`.`);
  }
  if (/<input/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<input>\`.`);
  }
  if (/<button/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<button>\`.`);
  }
  if (/<link/i.test(contentHtml)) {
    errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa mã độc \`<link>\`.`);
  }
  
  // 2. Extract and validate HTML tags and their attributes
  const tagRegex = /<(\/?)([a-zA-Z0-9:-]+)([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(contentHtml)) !== null) {
    const slash = match[1];
    const tagName = match[2].toLowerCase();
    const attrs = match[3];
    
    // Check whitelist
    if (!whitelist.has(tagName)) {
      errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa thẻ HTML không thuộc whitelist: \`<${slash ? '/' : ''}${tagName}>\`.`);
      continue;
    }
    
    // Check attributes for opening tags
    if (!slash && attrs) {
      // Check event handlers (on* attributes)
      if (/\s+on[a-zA-Z]+\b/i.test(attrs)) {
        errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa event handler nguy hại trong thẻ \`<${tagName}>\`: \`${attrs.trim()}\`.`);
      }
      
      // Check javascript: URLs in attributes
      if (/javascript:/i.test(attrs)) {
        errors.push(`Tài liệu \`${docType}\` của sản phẩm \`${productCode}\` chứa javascript URL nguy hại trong thẻ \`<${tagName}>\`: \`${attrs.trim()}\`.`);
      }
    }
  }
  
  return errors;
}

interface CategoryStats {
  category_code: string;
  category_name: string;
  total_links: number;
  completed: number;
  failed: number;
  normalized_products: number;
}

async function main(): Promise<void> {
  logInfo('=== Step 07: Validate Data Quality ===');

  // 1. Read input files (State files are optional, so warnIfMissing is false)
  const rawLinks = safeReadJson<any[]>('data/raw/product_links.raw.json', []);
  const completedUrls = safeReadJson<string[]>('data/state/completed_urls.json', []);
  const failedUrls = safeReadJson<any[]>('data/state/failed_urls.json', [], false);
  const duplicateUrls = safeReadJson<string[]>('data/state/duplicate_urls.json', [], false);

  // Normalized CSVs (All CSVs are required, so safeReadCsv handles missing files as FAIL)
  const productsCsv = safeReadCsv('data/normalized/products.csv');
  const brandsCsv = safeReadCsv('data/normalized/brands.csv');
  const manufacturersCsv = safeReadCsv('data/normalized/manufacturers.csv');
  const countriesCsv = safeReadCsv('data/normalized/countries.csv');
  const productCategoriesCsv = safeReadCsv('data/normalized/product_categories.csv');
  const categoryClosuresCsv = safeReadCsv('data/normalized/category_closures.csv');
  const productVariantsCsv = safeReadCsv('data/normalized/product_variants.csv');
  const productImagesCsv = safeReadCsv('data/normalized/product_images.csv');
  const productPricesCsv = safeReadCsv('data/normalized/product_prices.csv');
  const medicinesCsv = safeReadCsv('data/normalized/medicines.csv');
  const medicineUnitsCsv = safeReadCsv('data/normalized/medicine_units.csv');
  const dosageFormsCsv = safeReadCsv('data/normalized/dosage_forms.csv');
  const activeIngredientsCsv = safeReadCsv('data/normalized/active_ingredients.csv');
  const medicineIngredientsCsv = safeReadCsv('data/normalized/medicine_ingredients.csv');
  const productDocumentsCsv = safeReadCsv('data/normalized/product_documents.csv');

  // 2. Count files inside raw products batches recursive
  const rawProductsDir = path.join(ROOT_DIR, 'data/raw/products');
  let totalCrawledFromBatches = 0;
  const batchFiles = listFilesRecursive(rawProductsDir, '.json');
  const batchUrlToCategoryCode = new Map<string, string>();
  const catCodeToName = new Map<string, string>();

  for (const file of batchFiles) {
    try {
      const parentDir = path.basename(path.dirname(file)); // Directory representing category code
      const fileContent = fs.readFileSync(file, 'utf-8');
      const batchData = JSON.parse(fileContent);
      if (Array.isArray(batchData)) {
        totalCrawledFromBatches += batchData.length;
        for (const item of batchData) {
          if (item.source && item.source.source_url) {
            batchUrlToCategoryCode.set(item.source.source_url, parentDir);

            // Infer category name from breadcrumbs or path
            let catName = 'Không rõ danh mục';
            if (item.category && item.category.category_path) {
              let pathArr: string[] = [];
              if (typeof item.category.category_path === 'string') {
                pathArr = item.category.category_path.split('>').map((s: string) => s.trim()).filter(Boolean);
              } else if (Array.isArray(item.category.category_path)) {
                pathArr = item.category.category_path.map((s: string) => s.trim()).filter(Boolean);
              }
              if (pathArr.length > 0) {
                catName = pathArr[pathArr.length - 1];
              }
            }
            if (parentDir && !catCodeToName.has(parentDir)) {
              catCodeToName.set(parentDir, catName);
            }
          }
        }
      }
    } catch (err) {
      warnings.push(`Cảnh báo chất lượng: Lỗi đọc file batch \`${path.relative(ROOT_DIR, file)}\`: ${(err as Error).message}`);
    }
  }

  // 3. Category Statistics mapping
  const urlToCatCode = new Map<string, string>();
  const urlToCatName = new Map<string, string>();

  for (const link of rawLinks) {
    if (link.product_url) {
      if (link.category_code) {
        urlToCatCode.set(link.product_url, link.category_code);
        if (link.category_name) {
          catCodeToName.set(link.category_code, link.category_name);
        }
      }
      if (link.category_name) {
        urlToCatName.set(link.product_url, link.category_name);
      }
    }
  }

  const allCategoryCodes = new Set<string>();
  for (const link of rawLinks) {
    if (link.category_code) allCategoryCodes.add(link.category_code);
  }
  for (const code of batchUrlToCategoryCode.values()) {
    allCategoryCodes.add(code);
  }
  for (const item of failedUrls) {
    if (item && typeof item === 'object' && item.category_code) {
      allCategoryCodes.add(item.category_code);
      if (item.category_name && !catCodeToName.has(item.category_code)) {
        catCodeToName.set(item.category_code, item.category_name);
      }
    }
  }

  const statsMap = new Map<string, CategoryStats>();
  for (const code of allCategoryCodes) {
    statsMap.set(code, {
      category_code: code,
      category_name: catCodeToName.get(code) || 'Không rõ danh mục',
      total_links: 0,
      completed: 0,
      failed: 0,
      normalized_products: 0
    });
  }

  // Populate link counts
  for (const link of rawLinks) {
    const code = link.category_code;
    if (code && statsMap.has(code)) {
      statsMap.get(code)!.total_links++;
    }
  }

  // Populate completed counts
  for (const url of completedUrls) {
    const code = urlToCatCode.get(url) || batchUrlToCategoryCode.get(url);
    if (code && statsMap.has(code)) {
      statsMap.get(code)!.completed++;
    }
  }

  // Populate failed counts
  for (const item of failedUrls) {
    let url = '';
    let code = '';
    if (typeof item === 'string') {
      url = item;
      code = urlToCatCode.get(url) || batchUrlToCategoryCode.get(url) || '';
    } else if (item && typeof item === 'object') {
      url = item.product_url || '';
      code = item.category_code || urlToCatCode.get(url) || batchUrlToCategoryCode.get(url) || '';
    }
    if (code && statsMap.has(code)) {
      statsMap.get(code)!.failed++;
    }
  }

  // Populate normalized counts
  for (const prod of productsCsv) {
    const url = prod.source_url;
    const code = urlToCatCode.get(url) || batchUrlToCategoryCode.get(url);
    if (code && statsMap.has(code)) {
      statsMap.get(code)!.normalized_products++;
    }
  }

  // 4. Compute field completeness
  const totalNormalized = productsCsv.length;
  const hasName = productsCsv.filter(p => p.product_name && p.product_name.trim() && p.product_name !== 'null').length;
  const hasCode = productsCsv.filter(p => p.product_code && p.product_code.trim() && p.product_code !== 'null').length;

  const priceProductCodes = new Set<string>();
  for (const price of productPricesCsv) {
    const pCode = price.variant_code ? price.variant_code.split('-')[0] : '';
    if (pCode && price.price && price.price.trim() && price.price !== 'null') {
      priceProductCodes.add(pCode);
    }
  }
  const hasPrice = productsCsv.filter(p => priceProductCodes.has(p.product_code)).length;

  const imageProductCodes = new Set<string>();
  for (const img of productImagesCsv) {
    if (img.product_code && img.image_url && img.image_url.trim()) {
      imageProductCodes.add(img.product_code);
    }
  }
  const hasImage = productsCsv.filter(p => imageProductCodes.has(p.product_code)).length;

  const hasBrand = productsCsv.filter(p => p.brand_code && p.brand_code.trim() && p.brand_code !== 'null').length;
  const hasManufacturer = productsCsv.filter(p => p.manufacturer_code && p.manufacturer_code.trim() && p.manufacturer_code !== 'null').length;
  const hasCategory = productsCsv.filter(p => p.category_code && p.category_code.trim() && p.category_code !== 'null').length;

  // Medicine details completeness
  const totalMedicines = medicinesCsv.length;
  const hasRegNum = medicinesCsv.filter(m => m.registration_number && m.registration_number.trim() && m.registration_number !== 'null').length;

  const ingredientProductCodes = new Set<string>();
  for (const ing of medicineIngredientsCsv) {
    if (ing.product_code && ing.ingredient_code) {
      ingredientProductCodes.add(ing.product_code);
    }
  }
  for (const doc of productDocumentsCsv) {
    if (doc.product_code && doc.document_type === 'RAW_INGREDIENTS' && doc.content && doc.content.trim()) {
      ingredientProductCodes.add(doc.product_code);
    }
  }
  const hasIngText = medicinesCsv.filter(m => ingredientProductCodes.has(m.product_code)).length;
  const hasDosageForm = medicinesCsv.filter(m => m.dosage_form_code && m.dosage_form_code.trim() && m.dosage_form_code !== 'null').length;
  const hasPrescription = medicinesCsv.filter(m => m.requires_prescription !== undefined && m.requires_prescription !== '').length;
  const hasShelfLife = medicinesCsv.filter(m => m.shelf_life_months && m.shelf_life_months.trim() && m.shelf_life_months !== 'null').length;

  const docProductCodesUsageDosage = new Set<string>();
  for (const doc of productDocumentsCsv) {
    if (doc.product_code && (doc.document_type === 'USAGE' || doc.document_type === 'DOSAGE') && doc.content && doc.content.trim()) {
      docProductCodesUsageDosage.add(doc.product_code);
    }
  }
  const hasUsageDosage = medicinesCsv.filter(m => docProductCodesUsageDosage.has(m.product_code)).length;

  const docProductCodesSideEffects = new Set<string>();
  for (const doc of productDocumentsCsv) {
    if (doc.product_code && doc.document_type === 'SIDE_EFFECTS' && doc.content && doc.content.trim()) {
      docProductCodesSideEffects.add(doc.product_code);
    }
  }
  const hasSideEffects = medicinesCsv.filter(m => docProductCodesSideEffects.has(m.product_code)).length;

  // CONTRAINDICATIONS check: Check CONTRAINDICATIONS docs, or search within PRECAUTIONS/WARNING docs
  const docProductCodesContra = new Set<string>();
  for (const doc of productDocumentsCsv) {
    const docTypeUpper = doc.document_type ? doc.document_type.toUpperCase() : '';
    const isContraType = docTypeUpper === 'CONTRAINDICATIONS';
    const isPrecautionOrWarning = docTypeUpper === 'PRECAUTIONS' || docTypeUpper === 'WARNING';
    
    if (doc.product_code && doc.content && doc.content.trim()) {
      if (isContraType) {
        docProductCodesContra.add(doc.product_code);
      } else if (isPrecautionOrWarning) {
        const textLower = doc.content.toLowerCase();
        if (textLower.includes('chống chỉ định')) {
          docProductCodesContra.add(doc.product_code);
          infos.push(`Thuốc \`${doc.product_code}\` có thông tin chống chỉ định nằm gộp trong tài liệu \`${doc.document_type}\`.`);
        }
      }
    }
  }
  const hasContra = medicinesCsv.filter(m => docProductCodesContra.has(m.product_code)).length;

  // STORAGE check: Check STORAGE docs in product_documents.csv or condition fields in medicines.csv
  const docProductCodesStorage = new Set<string>();
  for (const doc of productDocumentsCsv) {
    const docTypeUpper = doc.document_type ? doc.document_type.toUpperCase() : '';
    if (doc.product_code && docTypeUpper === 'STORAGE' && doc.content && doc.content.trim()) {
      docProductCodesStorage.add(doc.product_code);
    }
  }
  const hasStorage = medicinesCsv.filter(m => 
    docProductCodesStorage.has(m.product_code) || 
    (m.temperature_condition && m.temperature_condition.trim() && m.temperature_condition !== 'null') ||
    (m.light_condition && m.light_condition.trim() && m.light_condition !== 'null') ||
    (m.humidity_condition && m.humidity_condition.trim() && m.humidity_condition !== 'null')
  ).length;

  // Percentage formatting helper
  const pct = (num: number, total: number) => total > 0 ? ((num / total) * 100).toFixed(1) : '0.0';

  // 5. Gather warnings & errors
  // Duplicate codes & URLs (Severe integrity -> FAIL)
  const codeCounts = new Map<string, number>();
  for (const p of productsCsv) {
    if (p.product_code) {
      codeCounts.set(p.product_code, (codeCounts.get(p.product_code) || 0) + 1);
    }
  }
  for (const [code, count] of codeCounts.entries()) {
    if (count > 1) {
      fails.push(`Trùng lặp \`product_code\` \`${code}\` (${count} lần) trong \`products.csv\`.`);
    }
  }

  const urlCounts = new Map<string, number>();
  for (const p of productsCsv) {
    if (p.source_url) {
      urlCounts.set(p.source_url, (urlCounts.get(p.source_url) || 0) + 1);
    }
  }
  for (const [url, count] of urlCounts.entries()) {
    if (count > 1) {
      fails.push(`Trùng lặp \`source_url\` \`${url}\` (${count} lần) trong \`products.csv\`.`);
    }
  }

  // Text too long (Quality issue -> WARNING)
  for (const p of productsCsv) {
    if (p.short_description && p.short_description.length > 5000) {
      warnings.push(`Sản phẩm \`${p.product_code}\` có \`short_description\` quá dài (${p.short_description.length} ký tự).`);
    }
  }
  for (const d of productDocumentsCsv) {
    if (d.content && d.content.length > 10000) {
      warnings.push(`Tài liệu \`${d.document_type}\` của sản phẩm \`${d.product_code}\` quá dài (${d.content.length} ký tự).`);
    }
  }

  // Remaining HTML check in text fields (Quality issue -> WARNING/FAIL)
  const htmlTagRegex = /<\/?(p|br|div|span|strong|b|i|em|a|ul|ol|li|h[1-6]|table|tr|td|th|thead|tbody|tfoot|iframe|script|style|html|body|meta|link|head|img|font|hr|sub|sup|small|section|article|header|footer|nav|button|form|input|select|option|textarea|label)(?:\s+[^>\r\n]*)?\/?>/i;
  for (const p of productsCsv) {
    if (p.short_description && htmlTagRegex.test(p.short_description)) {
      warnings.push(`Sản phẩm \`${p.product_code}\` chứa thẻ HTML trong \`short_description\`.`);
    }
  }
  for (const d of productDocumentsCsv) {
    if (d.content && htmlTagRegex.test(d.content)) {
      fails.push(`Tài liệu \`${d.document_type}\` của sản phẩm \`${d.product_code}\` chứa thẻ HTML trong \`content\`.`);
    }
    // HTML inside content_html must be validated using whitelist/blacklist
    if (d.content_html && d.content_html.trim()) {
      const htmlFails = validateContentHtml(d.content_html, d.product_code, d.document_type);
      for (const err of htmlFails) {
        fails.push(err);
      }
      if (htmlTagRegex.test(d.content_html)) {
        infos.push(`Tài liệu \`${d.document_type}\` của sản phẩm \`${d.product_code}\` chủ động lưu cấu trúc HTML trong \`content_html\`.`);
      }
    }
  }

  // Products without categories (Quality issue -> WARNING)
  for (const p of productsCsv) {
    if (!p.category_code || p.category_code === 'null' || !p.category_code.trim()) {
      warnings.push(`Sản phẩm \`${p.product_code}\` (${p.product_name}) không liên kết với \`category_code\`.`);
    }
  }

  // Medicines without ingredients (Quality issue -> WARNING)
  for (const m of medicinesCsv) {
    if (!ingredientProductCodes.has(m.product_code)) {
      warnings.push(`Thuốc \`${m.product_code}\` không tìm thấy thành phần hoạt chất (\`medicine_ingredients.csv\`) hoặc tài liệu \`RAW_INGREDIENTS\`.`);
    }
  }

  // Missing Brand (Low priority -> INFO)
  for (const p of productsCsv) {
    if (!p.brand_code || p.brand_code === 'null' || !p.brand_code.trim()) {
      infos.push(`Sản phẩm \`${p.product_code}\` (${p.product_name}) không có nhãn hàng (brand).`);
    }
  }

  // Missing price check (CONTACT_REQUIRED is info, AVAILABLE missing is WARNING)
  for (const p of productsCsv) {
    const hasPriceVal = priceProductCodes.has(p.product_code);
    if (!hasPriceVal) {
      if (p.price_status === 'CONTACT_REQUIRED') {
        infos.push(`Sản phẩm \`${p.product_code}\` (${p.product_name}) yêu cầu liên hệ để biết giá (CONTACT_REQUIRED).`);
      } else {
        warnings.push(`Sản phẩm \`${p.product_code}\` (${p.product_name}) không có giá bán dù trạng thái giá là \`${p.price_status || 'UNKNOWN'}\`.`);
      }
    }
  }

  // Missing shelf life (Low priority -> INFO)
  for (const m of medicinesCsv) {
    if (!m.shelf_life_months || m.shelf_life_months === 'null' || !m.shelf_life_months.trim()) {
      infos.push(`Thuốc \`${m.product_code}\` không có thông tin hạn dùng (shelf_life_months).`);
    }
  }

  // Foreign keys validation (Referential integrity -> FAIL)
  const categoryCodesSet = new Set(productCategoriesCsv.map(c => c.category_code).filter(Boolean));
  const brandCodesSet = new Set(brandsCsv.map(b => b.brand_code).filter(Boolean));
  const manufacturerCodesSet = new Set(manufacturersCsv.map(m => m.manufacturer_code).filter(Boolean));
  const countryCodesSet = new Set(countriesCsv.map(c => c.country_code).filter(Boolean));
  const productCodesSet = new Set(productsCsv.map(p => p.product_code).filter(Boolean));
  const dosageFormCodesSet = new Set(dosageFormsCsv.map(d => d.dosage_form_code).filter(Boolean));
  const unitCodesSet = new Set(medicineUnitsCsv.map(u => u.unit_code).filter(Boolean));
  const ingredientCodesSet = new Set(activeIngredientsCsv.map(i => i.ingredient_code).filter(Boolean));
  const variantCodesSet = new Set(productVariantsCsv.map(v => v.variant_code).filter(Boolean));

  for (const p of productsCsv) {
    if (p.category_code && !categoryCodesSet.has(p.category_code)) {
      fails.push(`Sản phẩm \`${p.product_code}\` có \`category_code\` \`${p.category_code}\` không tồn tại trong \`product_categories.csv\`.`);
    }
    if (p.brand_code && p.brand_code !== 'null' && !brandCodesSet.has(p.brand_code)) {
      fails.push(`Sản phẩm \`${p.product_code}\` có \`brand_code\` \`${p.brand_code}\` không tồn tại trong \`brands.csv\`.`);
    }
    if (p.manufacturer_code && p.manufacturer_code !== 'null' && !manufacturerCodesSet.has(p.manufacturer_code)) {
      fails.push(`Sản phẩm \`${p.product_code}\` có \`manufacturer_code\` \`${p.manufacturer_code}\` không tồn tại trong \`manufacturers.csv\`.`);
    }
    if (p.country_code && p.country_code !== 'null' && !countryCodesSet.has(p.country_code)) {
      fails.push(`Sản phẩm \`${p.product_code}\` có \`country_code\` \`${p.country_code}\` không tồn tại trong \`countries.csv\`.`);
    }
  }

  for (const m of medicinesCsv) {
    if (!productCodesSet.has(m.product_code)) {
      fails.push(`Thuốc có \`product_code\` \`${m.product_code}\` không tồn tại trong \`products.csv\`.`);
    }
    if (m.dosage_form_code && m.dosage_form_code !== 'null' && !dosageFormCodesSet.has(m.dosage_form_code)) {
      fails.push(`Thuốc \`${m.product_code}\` có \`dosage_form_code\` \`${m.dosage_form_code}\` không tồn tại trong \`dosage_forms.csv\`.`);
    }
  }

  for (const mi of medicineIngredientsCsv) {
    if (!productCodesSet.has(mi.product_code)) {
      fails.push(`Dòng medicine_ingredients có \`product_code\` \`${mi.product_code}\` không tồn tại trong \`products.csv\`.`);
    }
    if (mi.ingredient_code && !ingredientCodesSet.has(mi.ingredient_code)) {
      fails.push(`Thuốc \`${mi.product_code}\` có \`ingredient_code\` \`${mi.ingredient_code}\` không tồn tại trong \`active_ingredients.csv\`.`);
    }
  }

  for (const pv of productVariantsCsv) {
    if (!productCodesSet.has(pv.product_code)) {
      fails.push(`Biến thể \`${pv.variant_code}\` có \`product_code\` \`${pv.product_code}\` không tồn tại trong \`products.csv\`.`);
    }
    if (pv.unit_code && pv.unit_code !== 'null' && !unitCodesSet.has(pv.unit_code)) {
      fails.push(`Biến thể \`${pv.variant_code}\` có \`unit_code\` \`${pv.unit_code}\` không tồn tại trong \`medicine_units.csv\`.`);
    }
  }

  for (const pp of productPricesCsv) {
    if (!variantCodesSet.has(pp.variant_code)) {
      fails.push(`Giá của biến thể \`${pp.variant_code}\` không tồn tại trong \`product_variants.csv\`.`);
    }
    if (pp.unit_code && pp.unit_code !== 'null' && !unitCodesSet.has(pp.unit_code)) {
      fails.push(`Giá của biến thể \`${pp.variant_code}\` có \`unit_code\` \`${pp.unit_code}\` không tồn tại trong \`medicine_units.csv\`.`);
    }
  }

  for (const pi of productImagesCsv) {
    if (!productCodesSet.has(pi.product_code)) {
      fails.push(`Ảnh có \`product_code\` \`${pi.product_code}\` không tồn tại trong \`products.csv\`.`);
    }
  }

  for (const pd of productDocumentsCsv) {
    if (!productCodesSet.has(pd.product_code)) {
      fails.push(`Tài liệu có \`product_code\` \`${pd.product_code}\` không tồn tại trong \`products.csv\`.`);
    }
  }

  // 6. Build Report sections
  const reportTime = new Date().toLocaleString('vi-VN', { hour12: false });
  const reportLines: string[] = [];

  reportLines.push('# Báo Cáo Đánh Giá Chất Lượng Dữ Liệu PharmaAssist\n');
  reportLines.push('Báo cáo này được tự động tạo nhằm kiểm tra chất lượng dữ liệu thu thập (crawled) và dữ liệu chuẩn hóa (normalized) trong hệ thống PharmaAssist.\n');

  // Section 1: Overview
  reportLines.push('## 1. Tổng quan chất lượng dữ liệu\n');
  reportLines.push('| Chỉ số chất lượng | Số lượng | Ý nghĩa / Ghi chú |');
  reportLines.push('| :--- | :---: | :--- |');
  reportLines.push(`| **Tổng số product links** | ${rawLinks.length} | Số lượng URL sản phẩm tìm thấy ban đầu |`);
  reportLines.push(`| **Tổng sản phẩm crawl thành công** | ${completedUrls.length} | Số lượng sản phẩm tải thông tin chi tiết thành công |`);
  reportLines.push(`| **Tổng sản phẩm lỗi (Failed)** | ${failedUrls.length} | Số lượng sản phẩm gặp lỗi khi crawl |`);
  reportLines.push(`| **Tổng duplicate URLs** | ${duplicateUrls.length} | Số lượng URL bị trùng lặp khi lấy link |`);
  reportLines.push(`| **Tổng sản phẩm normalized** | ${productsCsv.length} | Số lượng sản phẩm đã được đưa vào bảng \`products.csv\` |`);
  reportLines.push(`| **Thời điểm tạo báo cáo** | ${reportTime} | Thời gian chạy tiến trình kiểm tra dữ liệu |`);
  reportLines.push('\n');

  // Section 2: Category Statistics
  reportLines.push('## 2. Thống kê tiến trình thu thập và chuẩn hóa theo danh mục\n');
  reportLines.push('| Mã danh mục | Tên danh mục | Tổng link | Hoàn thành | Lỗi | Đã chuẩn hóa |');
  reportLines.push('| :--- | :--- | :---: | :---: | :---: | :---: |');
  let categoryRowsCount = 0;
  for (const stat of statsMap.values()) {
    reportLines.push(`| \`${stat.category_code}\` | ${stat.category_name} | ${stat.total_links} | ${stat.completed} | ${stat.failed} | ${stat.normalized_products} |`);
    categoryRowsCount++;
  }
  if (categoryRowsCount === 0) {
    reportLines.push('| - | Không có dữ liệu danh mục | 0 | 0 | 0 | 0 |');
  }
  reportLines.push('\n');

  // Section 3: Field Completeness
  reportLines.push('## 3. Thống kê độ đầy đủ của dữ liệu (Field Completeness)\n');
  reportLines.push(`### 3.1. Các trường thông tin sản phẩm chung (Tổng số: ${totalNormalized} sản phẩm)\n`);
  reportLines.push('| Trường thông tin | Số lượng có dữ liệu | Tỷ lệ đầy đủ | Mô tả |');
  reportLines.push('| :--- | :---: | :---: | :--- |');
  reportLines.push(`| \`product_name\` | ${hasName} | ${pct(hasName, totalNormalized)}% | Tên sản phẩm |`);
  reportLines.push(`| \`product_code\` | ${hasCode} | ${pct(hasCode, totalNormalized)}% | Mã SKU gốc của nhà thuốc |`);
  reportLines.push(`| \`price\` | ${hasPrice} | ${pct(hasPrice, totalNormalized)}% | Giá bán (có ít nhất một giá hợp lệ trong biến thể) |`);
  reportLines.push(`| \`image\` | ${hasImage} | ${pct(hasImage, totalNormalized)}% | Có ít nhất một ảnh minh họa |`);
  reportLines.push(`| \`brand\` | ${hasBrand} | ${pct(hasBrand, totalNormalized)}% | Nhãn hàng / Brand |`);
  reportLines.push(`| \`manufacturer\` | ${hasManufacturer} | ${pct(hasManufacturer, totalNormalized)}% | Nhà sản xuất |`);
  reportLines.push(`| \`category\` | ${hasCategory} | ${pct(hasCategory, totalNormalized)}% | Phân loại danh mục |`);
  reportLines.push('\n');

  reportLines.push(`### 3.2. Các trường thông tin chuyên sâu cho Thuốc (Tổng số: ${totalMedicines} thuốc)\n`);
  reportLines.push('| Trường thông tin | Số lượng có dữ liệu | Tỷ lệ đầy đủ | Mô tả |');
  reportLines.push('| :--- | :---: | :---: | :--- |');
  reportLines.push(`| \`registration_number\` | ${hasRegNum} | ${pct(hasRegNum, totalMedicines)}% | Số đăng ký thuốc (SDK) |`);
  reportLines.push(`| \`ingredients_text\` | ${hasIngText} | ${pct(hasIngText, totalMedicines)}% | Thành phần dược chất (đã phân tích hoặc raw) |`);
  reportLines.push(`| \`dosage_form\` | ${hasDosageForm} | ${pct(hasDosageForm, totalMedicines)}% | Dạng bào chế |`);
  reportLines.push(`| \`requires_prescription\` | ${hasPrescription} | ${pct(hasPrescription, totalMedicines)}% | Chỉ định kê đơn (Rx) |`);
  reportLines.push(`| \`shelf_life\` | ${hasShelfLife} | ${pct(hasShelfLife, totalMedicines)}% | Hạn dùng (tháng) |`);
  reportLines.push(`| \`usage/dosage\` | ${hasUsageDosage} | ${pct(hasUsageDosage, totalMedicines)}% | Hướng dẫn sử dụng và liều dùng |`);
  reportLines.push(`| \`side_effects\` | ${hasSideEffects} | ${pct(hasSideEffects, totalMedicines)}% | Tác dụng phụ |`);
  reportLines.push(`| \`contraindications\` | ${hasContra} | ${pct(hasContra, totalMedicines)}% | Chống chỉ định |`);
  reportLines.push(`| \`storage_instruction\` | ${hasStorage} | ${pct(hasStorage, totalMedicines)}% | Điều kiện và hướng dẫn bảo quản |`);
  reportLines.push('\n');

  // Section 4: Master Data
  reportLines.push('## 4. Thống kê dữ liệu danh mục gốc (Master Data)\n');
  reportLines.push('Các thực thể độc lập đã được tách bảng để tối ưu hóa liên kết và loại bỏ dư thừa dữ liệu (Deduplication):');
  reportLines.push(`- **Số quốc gia duy nhất (Countries):** ${countriesCsv.length}`);
  reportLines.push(`- **Số nhãn hàng duy nhất (Brands):** ${brandsCsv.length}`);
  reportLines.push(`- **Số nhà sản xuất duy nhất (Manufacturers):** ${manufacturersCsv.length}`);
  reportLines.push(`- **Số phân loại danh mục duy nhất (Categories):** ${productCategoriesCsv.length}`);
  reportLines.push(`- **Số dạng bào chế duy nhất (Dosage Forms):** ${dosageFormsCsv.length}`);
  reportLines.push(`- **Số đơn vị tính duy nhất (Medicine Units):** ${medicineUnitsCsv.length}`);
  reportLines.push(`- **Số hoạt chất duy nhất (Active Ingredients):** ${activeIngredientsCsv.length}`);
  reportLines.push('\n');

  // Section 5: Errors Lists
  reportLines.push('## 5. Danh sách lỗi và dữ liệu thiếu mẫu (Tối đa 20 dòng)\n');

  // 5.1. Top 20 failed URLs
  reportLines.push('### 5.1. 20 liên kết thu thập thất bại đầu tiên (Failed URLs)');
  if (failedUrls.length > 0) {
    reportLines.push('| # | URL lỗi | Mã danh mục | Thông báo lỗi | Lần thử |');
    reportLines.push('| :---: | :--- | :---: | :--- | :---: |');
    const limit = Math.min(20, failedUrls.length);
    for (let i = 0; i < limit; i++) {
      const item = failedUrls[i];
      const url = typeof item === 'string' ? item : (item.product_url || 'N/A');
      const code = typeof item === 'string' ? 'N/A' : (item.category_code || 'N/A');
      const errMsg = typeof item === 'string' ? 'Không rõ lý do' : (item.error_message || 'N/A');
      const retries = typeof item === 'string' ? '0' : String(item.retry_count ?? 0);
      reportLines.push(`| ${i + 1} | [Link](${url}) | \`${code}\` | ${errMsg} | ${retries} |`);
    }
  } else {
    reportLines.push('*Không phát hiện URL thu thập thất bại.*');
  }
  reportLines.push('\n');

  // 5.2. Missing Name
  reportLines.push('### 5.2. 20 sản phẩm thiếu tên sản phẩm (Missing Name)');
  const missingNameProducts = productsCsv.filter(p => !p.product_name || !p.product_name.trim() || p.product_name === 'null');
  if (missingNameProducts.length > 0) {
    reportLines.push('| # | Mã sản phẩm (Code) | Nguồn URL | Phân loại |');
    reportLines.push('| :---: | :--- | :--- | :--- |');
    const limit = Math.min(20, missingNameProducts.length);
    for (let i = 0; i < limit; i++) {
      const p = missingNameProducts[i];
      reportLines.push(`| ${i + 1} | \`${p.product_code}\` | [Link](${p.source_url}) | \`${p.product_type}\` |`);
    }
  } else {
    reportLines.push('*Không phát hiện sản phẩm nào thiếu tên.*');
  }
  reportLines.push('\n');

  // 5.3. Missing Price
  reportLines.push('### 5.3. 20 sản phẩm không có thông tin giá (Missing Price)');
  const missingPriceProducts = productsCsv.filter(p => !priceProductCodes.has(p.product_code));
  if (missingPriceProducts.length > 0) {
    reportLines.push('| # | Mã sản phẩm (Code) | Tên sản phẩm | Nguồn URL |');
    reportLines.push('| :---: | :--- | :--- | :--- |');
    const limit = Math.min(20, missingPriceProducts.length);
    for (let i = 0; i < limit; i++) {
      const p = missingPriceProducts[i];
      reportLines.push(`| ${i + 1} | \`${p.product_code}\` | ${p.product_name} | [Link](${p.source_url}) |`);
    }
  } else {
    reportLines.push('*Không phát hiện sản phẩm nào thiếu thông tin giá.*');
  }
  reportLines.push('\n');

  // 5.4. Missing Category
  reportLines.push('### 5.4. 20 sản phẩm chưa phân loại danh mục (Missing Category)');
  const missingCategoryProducts = productsCsv.filter(p => !p.category_code || !p.category_code.trim() || p.category_code === 'null');
  if (missingCategoryProducts.length > 0) {
    reportLines.push('| # | Mã sản phẩm (Code) | Tên sản phẩm | Nguồn URL |');
    reportLines.push('| :---: | :--- | :--- | :--- |');
    const limit = Math.min(20, missingCategoryProducts.length);
    for (let i = 0; i < limit; i++) {
      const p = missingCategoryProducts[i];
      reportLines.push(`| ${i + 1} | \`${p.product_code}\` | ${p.product_name} | [Link](${p.source_url}) |`);
    }
  } else {
    reportLines.push('*Không phát hiện sản phẩm nào thiếu liên kết danh mục.*');
  }
  reportLines.push('\n');

  // Section 6: Warnings status board
  reportLines.push('## 6. Cảnh báo chất lượng dữ liệu và toàn vẹn tham chiếu (Warnings)\n');
  reportLines.push('Phần này liệt kê tất cả các cảnh báo phát hiện trong quá trình đánh giá dữ liệu, được phân loại theo mức độ nghiêm trọng:\n');

  reportLines.push('### 🔴 LỖI NGHIÊM TRỌNG (FAIL) - Cần sửa ngay để tránh lỗi DB/Logic');
  if (fails.length > 0) {
    for (const f of fails) {
      reportLines.push(`- ${f}`);
    }
  } else {
    reportLines.push('*Không phát hiện lỗi nghiêm trọng (PASS).*');
  }
  reportLines.push('\n');

  reportLines.push('### 🟡 CẢNH BÁO CHẤT LƯỢNG (WARNING) - Cần lưu ý tối ưu dữ liệu');
  if (warnings.length > 0) {
    for (const w of warnings) {
      reportLines.push(`- ${w}`);
    }
  } else {
    reportLines.push('*Không có cảnh báo chất lượng (PASS).*');
  }
  reportLines.push('\n');

  reportLines.push('### 🔵 THÔNG TIN KHÁC (INFO) - Dữ liệu bị thiếu tự nhiên hoặc cấu trúc HTML');
  if (infos.length > 0) {
    for (const inf of infos) {
      reportLines.push(`- ${inf}`);
    }
  } else {
    reportLines.push('*Không có thông tin lưu ý.*');
  }
  reportLines.push('\n');

  // 7. Write to output file
  ensureDir(OUT_DIR);
  fs.writeFileSync(REPORT_FILE, reportLines.join('\n'), 'utf-8');

  logInfo(`Data quality report successfully written to: ${REPORT_FILE}`);
  
  if (fails.length > 0) {
    logWarn(`Completed with ${fails.length} severe FAIL issues. Please check the report.`);
  } else if (warnings.length > 0) {
    logWarn(`Completed with ${warnings.length} quality WARNING issues. Please check the report.`);
  } else {
    logInfo('Validation finished successfully with zero quality or integrity issues!');
  }
  logInfo('=== End Step 07 ===');
}

main().catch((err) => {
  logError('Fatal error in validate_data', err);
  process.exit(1);
});
