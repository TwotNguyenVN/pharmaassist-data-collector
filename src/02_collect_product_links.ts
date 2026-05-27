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

async function autoScrollAndLoadMore(page: Page, maxScrolls: number, maxClicks: number) {
  let scrollCount = 0;
  let clickCount = 0;
  let lastHeight = await page.evaluate(() => document.body.scrollHeight);
  
  while (scrollCount < maxScrolls) {
    // Scroll down 80% of window height
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await delay(600);
    
    // Attempt to click "Load More" / "Xem thêm"
    try {
      const buttons = await page.locator('button').filter({ hasText: /xem thêm|tải thêm|hiển thị thêm/i }).all();
      for (const btn of buttons) {
        if (await btn.isVisible() && clickCount < maxClicks) {
          // Hover before clicking to mimic real user behavior and prevent anti-bot trigger
          await btn.hover({ timeout: 2000 }).catch(() => {});
          
          // Fast random delay before clicking (300ms - 800ms)
          const preClickDelay = Math.floor(Math.random() * 500) + 300;
          await delay(preClickDelay);
          
          await btn.click({ force: false }).catch(async () => {
            // Fallback to force click if standard click is intercepted
            await btn.click({ force: true }).catch(() => {});
          });
          
          clickCount++;
          
          // Fast random delay after click for products to render (1500ms - 2500ms)
          const postClickDelay = Math.floor(Math.random() * 1000) + 1500;
          await delay(postClickDelay);
          break; 
        }
      }
    } catch (e) {
      // ignore
    }

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) {
      await delay(1000);
      if (await page.evaluate(() => document.body.scrollHeight) === lastHeight) {
         break; // Reached bottom
      }
    }
    lastHeight = newHeight;
    scrollCount++;
  }
}

async function extractProductLinks(page: Page, cat: CategoryRaw, baseUrl: string): Promise<ProductLinkRaw[]> {
  const collectedAt = new Date().toISOString();
  
  const links = await page.evaluate(({ cat, baseUrl, collectedAt }) => {
    const results: any[] = [];
    const anchors = Array.from(document.querySelectorAll('a'));
    
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('javascript:')) continue;
      
      let fullUrl = href;
      if (!href.startsWith('http')) {
        if (!href.startsWith('/')) fullUrl = '/' + href;
        fullUrl = baseUrl + fullUrl;
      }
      
      // Clean query and hash first
      const cleanedUrl = fullUrl.split('?')[0].split('#')[0];
      
      try {
        const path = new URL(cleanedUrl).pathname;
        const isValidSegment = /^\/(thuoc|thuc-pham-chuc-nang|trang-thiet-bi-y-te|duoc-my-pham|cham-soc-ca-nhan)\//.test(path);
        const isBlacklisted = /\/(chinh-sach|tin-tuc|he-thong-cua-hang|khuyen-mai|tuyen-dung|lien-he)\//.test(path);

        if (cleanedUrl.startsWith(baseUrl) && isValidSegment && !isBlacklisted && (cleanedUrl.includes('.html') || cleanedUrl.match(/-\d+$/))) {
          let name = a.textContent?.replace(/\s+/g, ' ').trim() || '';
          if (name.toLowerCase() === 'xem thêm' || name.toLowerCase() === 'chi tiết') {
             name = a.getAttribute('title') || '';
          }

          const img = a.querySelector('img');
          const imageUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;

          let priceText = null;
          let parent: HTMLElement | null = a.parentElement;
          let depth = 0;
          while (parent && depth < 3) {
             const textNodes = Array.from(parent.querySelectorAll('*')).map(el => el.textContent || '');
             const priceEl = textNodes.find(t => (t.includes('đ') || t.includes('₫') || t.includes('VNĐ')) && t.match(/\d/));
             if (priceEl) {
               priceText = priceEl.replace(/\s+/g, ' ').trim();
               break;
             }
             parent = parent.parentElement;
             depth++;
          }

          if (name.length > 3 || cleanedUrl) {
            results.push({
              category_code: cat.category_code,
              category_name: cat.category_name,
              category_url: cat.category_url,
              product_name: name.length > 0 ? name : null,
              product_url: cleanedUrl,
              image_url: imageUrl,
              price_text: priceText,
              collected_at: collectedAt
            });
          }
        }
      } catch (urlErr) {
        // Skip invalid URL formats
      }
    }
    return results;
  }, { cat, baseUrl, collectedAt });
  
  return links;
}

async function main(): Promise<void> {
  logInfo('=== Step 02: Collect Product Links ===');
  
  const headlessEnv = process.env.HEADLESS !== 'false';
  const minDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MIN_MS ?? '2000', 10);
  const maxDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MAX_MS ?? '5000', 10);
  const mode = process.env.CRAWL_MODE ?? 'sample';
  const maxProducts = parseInt(process.env.MAX_PRODUCTS ?? '200', 10);
  
  const defaultScroll = mode === 'sample' ? '3' : '30';
  const defaultLoadMore = mode === 'sample' ? '0' : '30';
  const maxScrollRounds = parseInt(process.env.MAX_SCROLL_ROUNDS ?? defaultScroll, 10);
  const maxLoadMore = parseInt(process.env.MAX_LOAD_MORE_CLICKS ?? defaultLoadMore, 10);

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

  // Filter: If a category has children in the dataset, skip it (prioritize leaf categories)
  const parentCodes = new Set(allCats.map(c => c.parent_category_code).filter(Boolean));
  let toCrawl = allCats.filter(cat => !parentCodes.has(cat.category_code));

  // Skip alphabetical A-Z search pages (they don't contain direct product grids and cause duplicate issues)
  toCrawl = toCrawl.filter(cat => !cat.category_url.includes('/tra-cuu-thuoc'));

  // Sync with enabled configurations in category_urls.json
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
      await page.goto(cat.category_url, { waitUntil: 'networkidle', timeout: 30000 });
      
      const baseUrl = new URL(cat.category_url).origin;
      await autoScrollAndLoadMore(page, maxScrollRounds, maxLoadMore);
      
      let extracted = await extractProductLinks(page, cat, baseUrl);
      
      let isBlocked = isCloudflareBlocked(extracted);
      if (isBlocked) {
        logWarn(`\n================================================================================`);
        logWarn(`[WARNING] CLOUDFLARE RATE LIMIT DETECTED!`);
        logWarn(`Category "${cat.category_name}" returned only static advertising links.`);
        logWarn(`Your IP is currently blocked/rate-limited by Cloudflare WAF.`);
        logWarn(`--------------------------------------------------------------------------------`);
        logWarn(`ACTION REQUIRED: Please reset your IP now (e.g. toggle Airplane mode on/off on your 4G device).`);
        logWarn(`================================================================================\n`);
        
        let ipResetDone = false;
        while (!ipResetDone) {
          const proceed = await askToContinue(`Have you reset your IP? Press 'y' (or Enter) to retry, or 'n' to skip: `);
          if (proceed) {
            logInfo(`Retrying category: ${cat.category_name}...`);
            await page.goto(cat.category_url, { waitUntil: 'networkidle', timeout: 30000 });
            await autoScrollAndLoadMore(page, maxScrollRounds, maxLoadMore);
            extracted = await extractProductLinks(page, cat, baseUrl);
            
            if (!isCloudflareBlocked(extracted)) {
              let retryNewCount = 0;
              for (const link of extracted) {
                if (uniqueLinks.has(link.product_url)) {
                  duplicateUrls.push(link.product_url);
                } else {
                  uniqueLinks.set(link.product_url, link);
                  retryNewCount++;
                }
              }
              logInfo(`Retry successful! Found ${extracted.length} links (${retryNewCount} new). Total unique: ${uniqueLinks.size}`);
              ipResetDone = true;
              consecutiveNoNewLinks = 0;
              break;
            } else {
              logWarn(`Retry failed. Still getting static footer links. Cloudflare is still blocking this IP.`);
            }
          } else {
            logWarn(`Skipping retry for category: ${cat.category_name}.`);
            // Add what we currently have (the static links) to avoid losing them
            for (const link of extracted) {
              if (uniqueLinks.has(link.product_url)) {
                duplicateUrls.push(link.product_url);
              } else {
                uniqueLinks.set(link.product_url, link);
              }
            }
            ipResetDone = true;
            consecutiveNoNewLinks++;
            break;
          }
        }
      } else {
        let newCount = 0;
        for (const link of extracted) {
          if (uniqueLinks.has(link.product_url)) {
            duplicateUrls.push(link.product_url);
          } else {
            uniqueLinks.set(link.product_url, link);
            newCount++;
          }
        }
        
        logInfo(`Found ${extracted.length} links (${newCount} new). Total unique: ${uniqueLinks.size}, Duplicates: ${duplicateUrls.length}`);
        
        if (newCount === 0) {
          consecutiveNoNewLinks++;
        } else {
          consecutiveNoNewLinks = 0;
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
