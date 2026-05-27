/**
 * Step 02: Collect product links from category pages.
 */

import { chromium, type Page } from 'playwright';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

import { readJson, writeJson, ensureDir } from './utils/file.js';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { randomDelay, delay } from './utils/delay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');

function askToContinue(promptMessage: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(promptMessage, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes' || normalized === '');
    });
  });
}

function isCloudflareBlocked(extractedLinks: ProductLinkRaw[]): boolean {
  if (extractedLinks.length === 0) return true; // Empty page (usually blocked API)
  
  // Expand the static list to include all 31 template sidebar/footer recommendation links
  const templateStaticUrls = [
    // 11 items from previous footerStaticUrls (Thuốc)
    'klenzit-15g-3330.html',
    'berocca-1515.html',
    'farzincol-10mg-3786.html',
    'efferalgan-500mg-1620.html',
    'clorpheniramin-4-200v-4228.html',
    'enterogemina-5ml-sanofi-20-ong-17315.html',
    'smecta-2236.html',
    'telfast-180mg-2051.html',
    'kremils-s-3315.html',
    'eugica-vien-uong-dieu-tri-ho-cam-cum-490.html',
    'differin-0130mg-17372.html',
    // 5 items from TPCN recommendations
    'omega-3-power-120-v.html',
    'nutrigrow-nutrimed-60-v.html',
    'easylife-immuvita-100-v.html',
    'siro-bo-sung-canxi-d3-k2-kingphar-6-x5-ong.html',
    'siro-tang-cuong-suc-de-khang-va-chieu-cao-cho-tre-kid-grow-kenko-100-ml.html',
    // 5 items from cosmetic recommendations
    'pax-moly-blemish-care-30-ml-orange',
    'svr-sebiaclear-gel-moussant',
    'rice-therapy-rice-heartleaf-acne-cleanser',
    'centella-cleansing-water',
    'water-luminous-s-o-s-ringer-cleansing-water',
    // 5 items from personal care recommendations (BCS)
    'bao-cao-su-okamoto-crown',
    'bcs-sagami-classic',
    'bcs-sagami-love-me-gold',
    'bcs-safefit-freezer-max',
    'bcs-safefit-003',
    // 5 items from medical equipment recommendations
    'gac-rang-mieng-sachi',
    'kim-lay-mau-lancet',
    'nazorel-shampoo',
    'xit-thom-mieng-aro-mouth',
    'otosan-nasal-spray-baby'
  ];

  // Count how many extracted links do NOT belong to this template static list
  const nonStaticLinks = extractedLinks.filter(link => 
    !templateStaticUrls.some(staticUrl => link.product_url.includes(staticUrl))
  );

  // If there are 0 non-static links, it means we did NOT load any category-specific product cards
  // (we only extracted template recommendations). This indicates that the product list API failed
  // to load (usually due to a Cloudflare API rate limit / soft block).
  return nonStaticLinks.length === 0;
}

// Load env
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
  enabled: boolean;
}

interface CategoryRaw {
  category_code: string;
  category_name: string;
  category_url: string;
  parent_category_code: string | null;
  level: number;
}

interface ProductLinkRaw {
  category_code: string;
  category_name: string;
  category_url: string;
  product_name: string | null;
  product_url: string;
  image_url: string | null;
  price_text: string | null;
  collected_at: string;
}

async function fetchCategoryProductsViaApi(
  page: Page, 
  cat: CategoryRaw, 
  baseUrl: string,
  minDelay: number,
  maxDelay: number,
  mode: string,
  maxProducts: number,
  uniqueLinks: Map<string, ProductLinkRaw>,
  duplicateUrls: string[]
): Promise<{ success: boolean; newLinksCount: number; errorReason?: string }> {
  const catPath = new URL(cat.category_url).pathname;
  const cleanCatSlug = catPath.replace(/^\//, '');
  
  const checkpointPath = path.join(ROOT_DIR, 'data/state/links_checkpoint.json');
  let checkpoints: Record<string, { skipCount: number }> = {};
  if (fs.existsSync(checkpointPath)) {
    try {
      checkpoints = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    } catch (e) {}
  }
  
  let skipCount = 0;
  if (process.env.RESUME !== 'false' && checkpoints[cat.category_code]) {
    skipCount = checkpoints[cat.category_code].skipCount;
    logInfo(`Resuming category ${cat.category_name} from skipCount: ${skipCount}`);
  }
  
  const apiBatchSize = 50;
  let hasMore = true;
  let newLinksCount = 0;
  let consecutiveErrors = 0;

  const currentUrl = page.url();
  if (!currentUrl.startsWith('https://nhathuoclongchau.com.vn')) {
    await page.goto('https://nhathuoclongchau.com.vn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  while (hasMore) {
    if (mode === 'sample' && uniqueLinks.size >= maxProducts) {
      logInfo(`Reached MAX_PRODUCTS (${maxProducts}) in sample mode. Stopping early.`);
      break;
    }

    logInfo(`Fetching products for category "${cat.category_name}" - skipCount: ${skipCount}...`);

    const result = await page.evaluate(async ({ cleanCatSlug, skipCount, apiBatchSize }) => {
      const url = 'https://api.nhathuoclongchau.com.vn/lccus/search-product-service/api/products/ecom/product/search/cate';
      const payload = {
        skipCount,
        maxResultCount: apiBatchSize,
        codes: ["productTypes", "priceRanges", "brand", "brandOrigin", "producer"],
        sortType: 4,
        category: [cleanCatSlug]
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          return { error: `HTTP ${res.status} ${res.statusText}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (err: any) {
        return { error: err.message };
      }
    }, { cleanCatSlug, skipCount, apiBatchSize });

    if (result.error) {
      logError(`Failed to fetch API: ${result.error}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        return { success: false, newLinksCount, errorReason: result.error };
      }
      await delay(5000);
      continue;
    }

    consecutiveErrors = 0;
    const products = result.data?.products || [];
    logInfo(`API returned ${products.length} products.`);

    if (products.length === 0) {
      hasMore = false;
      break;
    }

    const collectedAt = new Date().toISOString();
    let pageNewCount = 0;

    for (const prod of products) {
      if (!prod.slug) continue;
      
      let productUrl = prod.slug;
      if (!productUrl.startsWith('http')) {
        if (!productUrl.startsWith('/')) productUrl = '/' + productUrl;
        productUrl = baseUrl + productUrl;
      }
      
      const cleanedUrl = productUrl.split('?')[0].split('#')[0];
      
      let priceText = null;
      if (prod.price && typeof prod.price.price === 'number') {
        const amount = prod.price.price.toLocaleString('vi-VN') + 'đ';
        const unit = prod.price.measureUnitName || '';
        priceText = unit ? `${amount} / ${unit}` : amount;
      }

      const linkItem: ProductLinkRaw = {
        category_code: cat.category_code,
        category_name: cat.category_name,
        category_url: cat.category_url,
        product_name: prod.webName || prod.name || null,
        product_url: cleanedUrl,
        image_url: prod.image || null,
        price_text: priceText,
        collected_at: collectedAt
      };

      if (uniqueLinks.has(cleanedUrl)) {
        duplicateUrls.push(cleanedUrl);
      } else {
        uniqueLinks.set(cleanedUrl, linkItem);
        newLinksCount++;
        pageNewCount++;
      }
    }

    logInfo(`Processed page: Found ${products.length} links (${pageNewCount} new). Total unique: ${uniqueLinks.size}`);

    skipCount += products.length;

    if (process.env.RESUME !== 'false') {
      checkpoints[cat.category_code] = { skipCount };
      try {
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoints, null, 2), 'utf-8');
      } catch (e) {}
      
      const outLinksPath = path.join(ROOT_DIR, 'data/raw/product_links.raw.json');
      try {
        fs.writeFileSync(outLinksPath, JSON.stringify(Array.from(uniqueLinks.values()), null, 2), 'utf-8');
      } catch (e) {}
    }

    if (products.length < apiBatchSize) {
      hasMore = false;
      break;
    }

    await randomDelay(minDelay, maxDelay);
  }

  if (process.env.RESUME !== 'false' && !hasMore) {
    delete checkpoints[cat.category_code];
    try {
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoints, null, 2), 'utf-8');
    } catch (e) {}
  }

  return { success: true, newLinksCount };
}

async function main(): Promise<void> {
  logInfo('=== Step 02: Collect Product Links ===');
  
  const headlessEnv = process.env.HEADLESS !== 'false';
  const minDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MIN_MS ?? '2000', 10);
  const maxDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MAX_MS ?? '5000', 10);
  const mode = process.env.CRAWL_MODE ?? 'sample';
  const maxProducts = parseInt(process.env.MAX_PRODUCTS ?? '200', 10);
  
  const rawCategoriesPath = path.join(ROOT_DIR, 'data/raw/categories.raw.json');
  const urlsPath = path.join(ROOT_DIR, 'category_urls.json');
  
  let allCats: CategoryRaw[] = [];
  if (fs.existsSync(rawCategoriesPath)) {
    allCats = readJson<CategoryRaw[]>(rawCategoriesPath, []);
  } else {
    logWarn(`categories.raw.json not found. Falling back to category_urls.json`);
    const defs = readJson<CategoryUrlDef[]>(urlsPath, []);
    allCats = defs.filter(d => d.enabled).map(d => ({
      category_code: d.categoryCode,
      category_name: d.categoryName,
      category_url: d.url,
      parent_category_code: null,
      level: 1
    }));
  }

  if (allCats.length === 0) {
    logError('No categories to crawl.');
    return;
  }

  const parentCodes = new Set(allCats.map(c => c.parent_category_code).filter(Boolean));
  let toCrawl = allCats.filter(cat => !parentCodes.has(cat.category_code));

  toCrawl = toCrawl.filter(cat => !cat.category_url.includes('/tra-cuu-thuoc'));

  function getRootCode(code: string): string {
    if (code.startsWith('CAT_THUOC')) return 'CAT_THUOC';
    if (code.startsWith('CAT_TPCN')) return 'CAT_TPCN';
    if (code.startsWith('CAT_TBYT')) return 'CAT_TBYT';
    if (code.startsWith('CAT_DUOC_MY_PHAM')) return 'CAT_DUOC_MY_PHAM';
    if (code.startsWith('CAT_CHAM_SOC_CA_NHAN')) return 'CAT_CHAM_SOC_CA_NHAN';
    return code;
  }

  if (fs.existsSync(urlsPath)) {
    const defs = readJson<CategoryUrlDef[]>(urlsPath, []);
    const enabledRoots = new Set(defs.filter(d => d.enabled).map(d => d.categoryCode));
    toCrawl = toCrawl.filter(cat => {
      const rootCode = getRootCode(cat.category_code);
      return enabledRoots.has(rootCode);
    });
  }

  logInfo(`Found ${toCrawl.length} leaf categories to crawl (mode: ${mode}).`);

  logInfo(`Launching browser (headless: ${headlessEnv})`);
  const browser = await chromium.launch({ headless: headlessEnv });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const outLinksPath = path.join(ROOT_DIR, 'data/raw/product_links.raw.json');
  const uniqueLinks = new Map<string, ProductLinkRaw>();
  
  if (fs.existsSync(outLinksPath)) {
    try {
      const existing = readJson<ProductLinkRaw[]>(outLinksPath, []);
      for (const item of existing) {
        if (item && item.product_url) {
          uniqueLinks.set(item.product_url, item);
        }
      }
      logInfo(`Loaded ${uniqueLinks.size} existing product links from ${outLinksPath}`);
    } catch (err) {
      logWarn(`Could not read existing product links from ${outLinksPath}: ${err}`);
    }
  }

  const duplicateUrls: string[] = [];
  let errorCount = 0;
  let consecutiveNoNewLinks = 0;

  for (const cat of toCrawl) {
    if (mode === 'sample') {
      if (uniqueLinks.size >= maxProducts) {
        logInfo(`Reached MAX_PRODUCTS (${maxProducts}) in sample mode. Stopping early.`);
        break;
      }
      if (consecutiveNoNewLinks >= 5) {
        logInfo(`Detected 5 consecutive categories with 0 new links in sample mode. Stopping early to prevent bottleneck.`);
        break;
      }
    }

    logInfo(`Crawling category: ${cat.category_name} (${cat.category_url})`);
    
    try {
      const baseUrl = new URL(cat.category_url).origin;
      let success = false;
      
      while (!success) {
        const runResult = await fetchCategoryProductsViaApi(
          page, cat, baseUrl, minDelay, maxDelay, mode, maxProducts, uniqueLinks, duplicateUrls
        );
        
        if (runResult.success) {
          success = true;
          consecutiveNoNewLinks = runResult.newLinksCount === 0 ? (consecutiveNoNewLinks + 1) : 0;
        } else {
          const errorReason = runResult.errorReason || 'Unknown error';
          logWarn(`\n================================================================================`);
          logWarn(`[WARNING] CRAWL ERROR / CLOUDFLARE BLOCK DETECTED!`);
          logWarn(`Category "${cat.category_name}" failed: ${errorReason}`);
          logWarn(`--------------------------------------------------------------------------------`);
          logWarn(`ACTION REQUIRED: Please reset your IP now (e.g. toggle Airplane mode on/off on your 4G device).`);
          logWarn(`================================================================================\n`);
          
          const proceed = await askToContinue(`Have you reset your IP? Press 'y' (or Enter) to retry, or 'n' to skip: `);
          if (!proceed) {
            logWarn(`Skipping retry for category: ${cat.category_name}.`);
            errorCount++;
            break;
          }
        }
      }
      
    } catch (err) {
      logError(`Error processing category ${cat.category_name}`, err);
      errorCount++;
    }

    logInfo(`Waiting for next category...`);
    await randomDelay(minDelay, maxDelay);
  }


  await browser.close();

  // Export results
  const outDuplicatesPath = path.join(ROOT_DIR, 'data/state/duplicate_urls.json');
  
  ensureDir(path.dirname(outLinksPath));
  ensureDir(path.dirname(outDuplicatesPath));
  
  let finalLinks = Array.from(uniqueLinks.values());
  if (mode === 'sample' && finalLinks.length > maxProducts) {
    finalLinks = finalLinks.slice(0, maxProducts);
  }
  
  writeJson(outLinksPath, finalLinks);
  writeJson(outDuplicatesPath, duplicateUrls);

  logInfo('=== Link Collection Summary ===');
  logInfo(`Total Categories Processed: ${toCrawl.length - errorCount}/${toCrawl.length}`);
  logInfo(`Total Unique Links: ${finalLinks.length}`);
  logInfo(`Total Duplicates: ${duplicateUrls.length}`);
  logInfo(`Total Errors: ${errorCount}`);
  logInfo(`Results saved to: ${outLinksPath}`);
  logInfo('=== End Step 02 ===');
}

main().catch((err) => {
  logError('Fatal error in collect:links', err);
  process.exit(1);
});
