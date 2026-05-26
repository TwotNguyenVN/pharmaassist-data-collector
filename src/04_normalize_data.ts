import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { stringify } from 'csv-stringify/sync';
import slugify from 'slugify';

import { readJson, ensureDir, listFilesRecursive } from './utils/file.js';
import { logInfo, logError } from './utils/logger.js';
import type { ProductRaw } from './types/product-raw.type.js';
import { sanitizeContentHtml, htmlToPlainText } from './utils/text-cleaner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');
const RAW_DIR = path.join(ROOT_DIR, 'data/raw/products');
const OUT_DIR = path.join(ROOT_DIR, 'data/normalized');

class IdGenerator {
  private prefix: string;
  private current: number = 0;
  private length: number;

  constructor(prefix: string, length: number = 6) {
    this.prefix = prefix;
    this.length = length;
  }

  next(): string {
    this.current++;
    return `${this.prefix}${String(this.current).padStart(this.length, '0')}`;
  }
}

class MasterDataManager<T> {
  private generator: IdGenerator;
  private map: Map<string, string> = new Map();
  private records: T[] = [];

  constructor(prefix: string) {
    this.generator = new IdGenerator(prefix);
  }

  getOrAdd(name: string | null, builder: (id: string, name: string) => T): string | null {
    if (!name) return null;
    const cleanName = name.trim();
    if (!cleanName) return null;
    const key = cleanName.toLowerCase();
    if (this.map.has(key)) return this.map.get(key)!;
    
    const newId = this.generator.next();
    this.map.set(key, newId);
    this.records.push(builder(newId, cleanName));
    return newId;
  }

  getRecords(): T[] {
    return this.records;
  }
}

function toSlug(text: string | null): string | null {
  if (!text) return null;
  return slugify(text, { lower: true, strict: true, locale: 'vi' });
}

function cleanHtml(text: string | null, maxLength: number = 500): string | null {
  if (!text) return null;
  let clean = text.replace(/<style[^>]*>.*?<\/style>/gi, '')
                  .replace(/<script[^>]*>.*?<\/script>/gi, '')
                  .replace(/<[^>]*>?/gm, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength) + '...';
  }
  return clean;
}

function cleanUnusualLineTerminators<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'string') {
    return obj.replace(/\u2028/g, '\n').replace(/\u2029/g, '\n') as any;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUnusualLineTerminators) as any;
  }
  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      newObj[key] = cleanUnusualLineTerminators((obj as any)[key]);
    }
    return newObj;
  }
  return obj;
}



function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const numStr = text.replace(/[^\d]/g, '');
  if (!numStr) return null;
  return parseInt(numStr, 10);
}

function mapProductType(typeStr: string | null): string {
  if (!typeStr) return 'OTHER';
  const t = typeStr.toLowerCase();
  if (t.includes('thuốc') || t === 'medicine') return 'MEDICINE';
  if (t.includes('thực phẩm chức năng') || t.includes('bảo vệ sức khỏe') || t === 'supplement') return 'SUPPLEMENT';
  if (t.includes('mỹ phẩm') || t.includes('dược mỹ phẩm') || t === 'cosmetic') return 'COSMETIC';
  if (t.includes('thiết bị y tế') || t.includes('trang thiết bị') || t === 'device') return 'DEVICE';
  if (t.includes('chăm sóc cá nhân') || t === 'personal_care') return 'PERSONAL_CARE';
  return 'OTHER';
}

function exportCsv(filename: string, data: any[], columns?: string[]) {
  const outPath = path.join(OUT_DIR, filename);
  if (data.length === 0) {
    if (columns && columns.length > 0) {
      fs.writeFileSync(outPath, columns.join(',') + '\n');
      logInfo(`Exported 0 records (headers only) to ${filename}`);
    } else {
      fs.writeFileSync(outPath, '');
    }
    return;
  }
  const csvOptions: any = { header: true, cast: { boolean: (value: any) => value ? 'true' : 'false' } };
  if (columns && columns.length > 0) {
    csvOptions.columns = columns;
  }
  const csvStr = stringify(data, csvOptions);
  fs.writeFileSync(outPath, csvStr);
  logInfo(`Exported ${data.length} records to ${filename}`);
}

async function main() {
  logInfo('=== Step 04: Normalize Data ===');
  ensureDir(OUT_DIR);

  const allFiles = listFilesRecursive(RAW_DIR, '.json');
  logInfo(`Found ${allFiles.length} batch files.`);

  // Managers
  const brandsMgr = new MasterDataManager('BR');
  const mfrsMgr = new MasterDataManager('MFR');
  const countriesMgr = new MasterDataManager('CTY');
  const dfsMgr = new MasterDataManager('DF');
  const unitsMgr = new MasterDataManager('UNIT');
  const ingredientsMgr = new MasterDataManager('ING');
  const categoriesMgr = new MasterDataManager('CAT');
  const prodGenerator = new IdGenerator('P');

  // Arrays for output
  const products: any[] = [];
  const product_variants: any[] = [];
  const product_images: any[] = [];
  const product_prices: any[] = [];
  const medicines: any[] = [];
  const medicine_ingredients: any[] = [];
  const product_documents: any[] = [];
  
  // Category specific
  const categoryMap = new Map<string, string>(); // path -> catCode
  const product_categories: any[] = [];
  const category_closures: any[] = [];

  function getCommonFields(raw: ProductRaw) {
    return {
      source_name: raw.source.source_name,
      source_url: raw.source.source_url,
      source_note: raw.source.source_note,
      is_demo_data: raw.source.is_demo_data,
      collected_at: raw.source.collected_at
    };
  }

  function resolveCategory(rawPath: any, common: any): string | null {
    if (!rawPath) return null;
    let pathArr: string[] = [];
    if (typeof rawPath === 'string') {
      pathArr = rawPath.split('>').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(rawPath)) {
      pathArr = rawPath.map(s => s.trim()).filter(Boolean);
    }
    
    if (pathArr.length === 0) return null;

    let currentPath = '';
    let parentCode: string | null = null;

    for (let i = 0; i < pathArr.length; i++) {
      const catName = pathArr[i].trim();
      currentPath = currentPath ? `${currentPath} > ${catName}` : catName;
      const key = currentPath.toLowerCase();

      let catCode = categoryMap.get(key);
      if (!catCode) {
        catCode = categoriesMgr.getOrAdd(key, (id) => id)!;
        categoryMap.set(key, catCode);

        product_categories.push({
          category_code: catCode,
          parent_category_code: parentCode,
          category_name: catName,
          category_slug: toSlug(catName),
          level: i + 1,
          ...common
        });

        // Closure self
        category_closures.push({
          ancestor_code: catCode,
          descendant_code: catCode,
          depth: 0,
          ...common
        });

        // Closure ancestors
        if (parentCode) {
          const ancestors = category_closures.filter(c => c.descendant_code === parentCode);
          for (const anc of ancestors) {
            category_closures.push({
              ancestor_code: anc.ancestor_code,
              descendant_code: catCode,
              depth: anc.depth + 1,
              ...common
            });
          }
        }
      }
      parentCode = catCode;
    }
    return parentCode;
  }

  const processedUrls = new Set<string>();

  for (const file of allFiles) {
    const rawBatch = readJson<ProductRaw[]>(file, []);
    const batch = cleanUnusualLineTerminators(rawBatch);
    for (const raw of batch) {
      const sourceUrl = raw.source?.source_url;
      if (!sourceUrl) continue;
      if (processedUrls.has(sourceUrl)) {
        continue;
      }
      processedUrls.add(sourceUrl);

      const common = getCommonFields(raw);

      // 1. Master Data
      const brandCode = brandsMgr.getOrAdd(raw.basic.brand_name, (id, name) => ({ brand_code: id, brand_name: name, brand_slug: toSlug(name), ...common }));
      const mfrCode = mfrsMgr.getOrAdd(raw.medicine.manufacturer_name, (id, name) => ({ manufacturer_code: id, manufacturer_name: name, manufacturer_slug: toSlug(name), ...common }));
      const countryCode = countriesMgr.getOrAdd(raw.basic.brand_country_name || raw.medicine.manufacturing_country, (id, name) => ({ country_code: id, country_name: name, country_slug: toSlug(name), ...common }));
      const dfCode = dfsMgr.getOrAdd(raw.medicine.dosage_form_name, (id, name) => ({ dosage_form_code: id, dosage_form_name: name, dosage_form_slug: toSlug(name), ...common }));
      const baseUnitCode = unitsMgr.getOrAdd(raw.pricing.default_unit, (id, name) => ({ unit_code: id, unit_name: name, ...common }));

      // Categories
      const catCode = resolveCategory(raw.category.category_path, common);

      // Product
      const productCode = prodGenerator.next();
      
      products.push({
        product_code: productCode,
        category_code: catCode,
        brand_code: brandCode,
        manufacturer_code: mfrCode,
        country_code: countryCode,
        product_name: raw.basic.product_name,
        product_slug: toSlug(raw.basic.product_name),
        product_type: raw.basic.product_type ? mapProductType(raw.basic.product_type) : mapProductType(raw.category.main_category_name),
        short_description: cleanHtml(raw.basic.short_description),
        rating_average: raw.basic.rating_average,
        review_count: raw.basic.review_count,
        base_unit_code: baseUnitCode,
        price_status: raw.pricing.price_status,
        ...common
      });

      // Images
      let imgOrder = 1;
      if (raw.media.primary_image_url) {
        product_images.push({
          product_code: productCode,
          image_url: raw.media.primary_image_url,
          is_primary: true,
          display_order: imgOrder++,
          ...common
        });
      }
      for (const img of raw.media.image_urls || []) {
        if (img !== raw.media.primary_image_url) {
          product_images.push({
            product_code: productCode,
            image_url: img,
            is_primary: false,
            display_order: imgOrder++,
            ...common
          });
        }
      }

      // Variants & Prices
      const pricesArr = raw.pricing.available_price_units || [];
      if (pricesArr.length > 0) {
        let vIndex = 1;
        for (const pu of pricesArr) {
          let variantCode = `${productCode}-V${vIndex++}`;
          const uCode = unitsMgr.getOrAdd(pu.unit_name, (id, name) => ({ unit_code: id, unit_name: name, ...common }));
          
          product_variants.push({
            variant_code: variantCode,
            product_code: productCode,
            sku: raw.basic.product_code || null,
            unit_code: uCode,
            unit_name: pu.unit_name,
            packaging_size: pu.product_specs || raw.medicine.package_specification,
            is_default: pu.is_default || false,
            is_sell_default: pu.is_sell_default || false,
            ...common
          });

          product_prices.push({
            variant_code: variantCode,
            unit_code: uCode,
            price: parsePrice(pu.price_text) || pu.price,
            currency: pu.currency_symbol || 'VND',
            is_default: pu.is_default || false,
            conversion_factor: null, // Hard to infer
            ...common
          });
        }
      } else {
        // If no available_price_units, create a default variant
        let variantCode = `${productCode}-V1`;
        product_variants.push({
          variant_code: variantCode,
          product_code: productCode,
          sku: raw.basic.product_code || null,
          unit_code: null,
          unit_name: 'Mặc định',
          packaging_size: raw.medicine.package_specification,
          is_default: true,
          is_sell_default: true,
          ...common
        });
      }

      // Medicines
      if (raw.medicine.is_medicine || raw.basic.product_type === 'Thuốc' || raw.basic.product_type === 'MEDICINE') {
        medicines.push({
          product_code: productCode,
          registration_number: raw.medicine.registration_number,
          dosage_form_code: dfCode,
          requires_prescription: raw.medicine.requires_prescription,
          shelf_life_months: raw.medicine.shelf_life_months,
          temperature_condition: raw.content.storage_temperature,
          light_condition: raw.content.storage_light_condition,
          humidity_condition: raw.content.storage_humidity_condition,
          ...common
        });
      }

      // Ingredients
      const parsedIngs = raw.ingredients.ingredients_parsed || [];
      if (parsedIngs.length > 0) {
        for (const ing of parsedIngs) {
          const ingCode = ingredientsMgr.getOrAdd(ing.name, (id, name) => ({
            ingredient_code: id,
            ingredient_name: name,
            ingredient_slug: toSlug(name),
            description: ing.shortDescription || null,
            ...common
          }));
          
          if (ingCode) {
            medicine_ingredients.push({
              product_code: productCode,
              ingredient_code: ingCode,
              strength_value: null, // Further parsing from shortDescription can be done if needed
              strength_unit: null,
              raw_text: ing.shortDescription || ing.name,
              ...common
            });
          }
        }
      } else if (raw.ingredients.ingredients_text) {
        // Fallback to document
        const rawContent = raw.ingredients.ingredients_text.trim();
        const hasHtml = /<[a-zA-Z/][^>]*>/.test(rawContent);
        product_documents.push({
          product_code: productCode,
          document_type: 'RAW_INGREDIENTS',
          title: 'Thành phần (chưa chuẩn hóa)',
          content: htmlToPlainText(rawContent),
          content_html: hasHtml ? sanitizeContentHtml(rawContent) : null,
          ...common
        });
      }

      // Documents
      const docFields = [
        { type: 'OVERVIEW', title: raw.content.overview_title || 'Tổng quan', content: raw.content.overview_content },
        { type: 'INDICATIONS', title: 'Chỉ định', content: raw.content.indications || raw.content.therapeutic_uses },
        { type: 'PHARMACODYNAMICS', title: 'Dược lực học', content: raw.content.pharmacodynamics },
        { type: 'PHARMACOKINETICS', title: 'Dược động học', content: raw.content.pharmacokinetics },
        { type: 'USAGE', title: 'Cách dùng', content: raw.content.usage_text },
        { type: 'DOSAGE', title: 'Liều dùng', content: raw.content.dosage_text },
        { type: 'OVERDOSE', title: 'Quá liều', content: raw.content.overdose_instruction },
        { type: 'MISSED_DOSE', title: 'Quên liều', content: raw.content.missed_dose_instruction },
        { type: 'SIDE_EFFECTS', title: 'Tác dụng phụ', content: raw.content.side_effects },
        { type: 'CONTRAINDICATIONS', title: 'Chống chỉ định', content: raw.content.contraindications },
        { type: 'PRECAUTIONS', title: 'Thận trọng', content: raw.content.precautions },
        { type: 'PREGNANCY_LACTATION', title: 'Phụ nữ có thai và cho con bú', content: raw.content.pregnancy_lactation_note },
        { type: 'DRIVING_MACHINE', title: 'Lái xe và vận hành máy móc', content: raw.content.driving_machine_note },
        { type: 'DRUG_INTERACTION', title: 'Tương tác thuốc', content: raw.content.drug_interaction_note },
        { type: 'STORAGE', title: 'Bảo quản', content: raw.content.storage_instruction || raw.content.storage_text }
      ];

      for (const doc of docFields) {
        if (doc.content && doc.content.trim()) {
          const rawContent = doc.content.trim();
          const hasHtml = /<[a-zA-Z/][^>]*>/.test(rawContent);
          product_documents.push({
            product_code: productCode,
            document_type: doc.type,
            title: doc.title,
            content: htmlToPlainText(rawContent),
            content_html: hasHtml ? sanitizeContentHtml(rawContent) : null,
            ...common
          });
        }
      }
    }
  }

  // Exports
  exportCsv('brands.csv', brandsMgr.getRecords(), ['brand_code', 'brand_name', 'brand_slug', 'source_name', 'source_url', 'source_note', 'is_demo_data', 'collected_at']);
  exportCsv('manufacturers.csv', mfrsMgr.getRecords());
  exportCsv('countries.csv', countriesMgr.getRecords());
  exportCsv('dosage_forms.csv', dfsMgr.getRecords());
  exportCsv('medicine_units.csv', unitsMgr.getRecords());
  exportCsv('active_ingredients.csv', ingredientsMgr.getRecords(), ['ingredient_code', 'ingredient_name', 'ingredient_slug', 'description', 'source_name', 'source_url', 'source_note', 'is_demo_data', 'collected_at']);
  
  exportCsv('product_categories.csv', product_categories);
  exportCsv('category_closures.csv', category_closures);
  exportCsv('products.csv', products);
  exportCsv('product_variants.csv', product_variants);
  exportCsv('product_images.csv', product_images);
  exportCsv('product_prices.csv', product_prices);
  exportCsv('medicines.csv', medicines);
  exportCsv('medicine_ingredients.csv', medicine_ingredients);
  exportCsv('product_documents.csv', product_documents, ['product_code', 'document_type', 'title', 'content', 'content_html', 'source_name', 'source_url', 'source_note', 'is_demo_data', 'collected_at']);

  logInfo('=== End Step 04 ===');
}

main().catch(err => {
  logError('Fatal error in normalize:data', err);
  process.exit(1);
});
