/**
 * Step 01: Collect subcategories from Long Chau main category pages.
 */

import { chromium, type Page } from 'playwright';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

import { readJson, writeJson, ensureDir } from './utils/file.js';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { randomDelay } from './utils/delay.js';
import { toSlug } from './utils/slug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');

// Load environment variables manually to avoid adding dotenv dependency
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] ? match[2].trim() : '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  });
}

interface CategoryUrlDef {
  categoryCode: string;
  categoryName: string;
  url: string;
  priority: number;
  estimatedProducts: number;
  enabled: boolean;
}

interface CategoryRaw {
  category_code: string;
  category_name: string;
  category_url: string;
  parent_category_code: string | null;
  parent_category_name: string | null;
  slug: string;
  level: number;
  product_count: number | null;
  image_url: string | null;
  source_url: string;
  source_name: string;
  source_note: string;
  is_demo_data: boolean;
  collected_at: string;
}

async function extractSubcategories(page: Page, parentUrl: string): Promise<{ name: string, url: string }[]> {
  try {
    const parentPath = new URL(parentUrl).pathname; // e.g. "/thuoc"
    
    // Attempt to extract from page by finding all anchor tags
    // and filtering for likely subcategory links.
    const subs = await page.evaluate((parentPathStr) => {
      const allLinks = Array.from(document.querySelectorAll('a'));
      const subcats = new Map<string, string>();
      
      for (const a of allLinks) {
        const href = a.getAttribute('href');
        if (!href) continue;
        
        let fullPath = href;
        try {
          if (href.startsWith('http')) {
            fullPath = new URL(href).pathname;
          }
        } catch(e) {}

        // Look for links that start with parent path, e.g. /thuoc/thuoc-di-ung
        // Exclude links that are just the parent path itself, or have query params, or look like products (.html or numbers at the end)
        if (fullPath.startsWith(parentPathStr + '/') && fullPath !== parentPathStr + '/') {
           if (!fullPath.includes('.html') && !fullPath.match(/-\d+$/)) {
             const nameText = a.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() || '';
             // Only take if it has sensible text
             if (nameText.length > 2 && nameText.length < 100) {
                // Ensure it's a relative/absolute path to same domain, keeping it clean
                const cleanPath = fullPath.split('?')[0].split('#')[0];
                // Keep the longest text for a given path (often one link is just an image, another is the text)
                if (!subcats.has(cleanPath) || subcats.get(cleanPath)!.length < nameText.length) {
                   subcats.set(cleanPath, nameText);
                }
             }
           }
        }
      }
      return Array.from(subcats.entries()).map(([url, name]) => ({ url, name }));
    }, parentPath);

    return subs;
  } catch (err) {
    logWarn(`Failed to extract subcategories from ${parentUrl}: ${err}`);
    return [];
  }
}

async function main(): Promise<void> {
  logInfo('=== Step 01: Collect Categories ===');
  
  const headlessEnv = process.env.HEADLESS !== 'false';
  const minDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MIN_MS ?? '2000', 10);
  const maxDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MAX_MS ?? '5000', 10);
  const sourceName = process.env.SOURCE_NAME ?? 'Nhà thuốc Long Châu';
  const sourceNote = process.env.SOURCE_NOTE ?? 'Dữ liệu tham khảo phục vụ đồ án PharmaAssist';

  const urlsPath = path.join(ROOT_DIR, 'category_urls.json');
  const allDefs = readJson<CategoryUrlDef[]>(urlsPath, []);
  const defs = allDefs.filter(d => d.enabled);

  if (defs.length === 0) {
    logWarn('No enabled categories found in category_urls.json');
    return;
  }

  logInfo(`Launching browser (headless: ${headlessEnv})`);
  const browser = await chromium.launch({ headless: headlessEnv });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  const results: CategoryRaw[] = [];
  let errorCount = 0;

  for (const def of defs) {
    logInfo(`Processing parent category: ${def.categoryName} (${def.url})`);
    
    const rootCat: CategoryRaw = {
      category_code: def.categoryCode,
      category_name: def.categoryName,
      category_url: def.url,
      parent_category_code: null,
      parent_category_name: null,
      slug: toSlug(def.categoryName),
      level: 1,
      product_count: def.estimatedProducts || null,
      image_url: null,
      source_url: def.url,
      source_name: sourceName,
      source_note: sourceNote,
      is_demo_data: true,
      collected_at: new Date().toISOString()
    };
    
    results.push(rootCat);

    try {
      // Goto URL
      await page.goto(def.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Generic extraction of subcategories based on URL patterns and DOM anchors
      const subcats = await extractSubcategories(page, def.url);
      logInfo(`Found ${subcats.length} potential subcategories for ${def.categoryName}`);
      
      let index = 1;
      for (const sub of subcats) {
        // Build full URL safely
        let subFullUrl = sub.url;
        if (!subFullUrl.startsWith('http')) {
          const baseUrl = new URL(def.url);
          subFullUrl = `${baseUrl.origin}${subFullUrl}`;
        }

        const subCat: CategoryRaw = {
          category_code: `${def.categoryCode}_SUB_${String(index).padStart(3, '0')}`,
          category_name: sub.name,
          category_url: subFullUrl,
          parent_category_code: def.categoryCode,
          parent_category_name: def.categoryName,
          slug: toSlug(sub.name),
          level: 2,
          product_count: null, // Hard to extract generically from links alone
          image_url: null,
          source_url: subFullUrl,
          source_name: sourceName,
          source_note: sourceNote,
          is_demo_data: true,
          collected_at: new Date().toISOString()
        };
        results.push(subCat);
        index++;
      }
      
    } catch (err) {
      logError(`Error processing category ${def.categoryName}`, err);
      errorCount++;
    }

    logInfo(`Waiting for next category...`);
    await randomDelay(minDelay, maxDelay);
  }

  await browser.close();

  // Save results to raw JSON
  const outPath = path.join(ROOT_DIR, 'data/raw/categories.raw.json');
  ensureDir(path.dirname(outPath));
  writeJson(outPath, results);

  const rootCount = results.filter(r => r.level === 1).length;
  const subCount = results.filter(r => r.level === 2).length;

  logInfo('=== Collection Summary ===');
  logInfo(`Total Root Categories: ${rootCount}`);
  logInfo(`Total Sub Categories: ${subCount}`);
  logInfo(`Total Errors: ${errorCount}`);
  logInfo(`Results saved to: ${outPath}`);
  logInfo('=== End Step 01 ===');
}

main().catch((err) => {
  logError('Fatal error in collect:categories', err);
  process.exit(1);
});
