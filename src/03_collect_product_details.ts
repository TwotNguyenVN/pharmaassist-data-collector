/**
 * Step 03: Collect detailed product information
 */

import { chromium, type Page } from 'playwright';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

import { readJson } from './utils/file.js';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { randomDelay } from './utils/delay.js';
import { loadCrawlState, saveCrawlState, markCompleted, markFailed, isCompleted, updateProgress } from './utils/checkpoint.js';
import { writeProductToBatch, flushBatch, getCurrentBatchIndex } from './utils/batch-writer.js';
import { type ProductRaw } from './types/product-raw.type.js';
import { crawlSingleProduct, type ProductLinkRaw } from './utils/crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');

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

async function main(): Promise<void> {
  logInfo('=== Step 03: Collect Product Details ===');
  
  const mode = process.env.CRAWL_MODE || 'sample';
  const headlessEnv = process.env.HEADLESS !== 'false';
  const batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
  const minDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MIN_MS || '2000', 10);
  const maxDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MAX_MS || '5000', 10);
  const maxProducts = parseInt(process.env.MAX_PRODUCTS || '10', 10);
  const resume = process.env.RESUME !== 'false';
  const linksPath = path.join(ROOT_DIR, 'data/raw/product_links.raw.json');
  if (!fs.existsSync(linksPath)) {
    logError(`Input file not found: ${linksPath}`);
    return;
  }

  let allLinks = readJson<ProductLinkRaw[]>(linksPath, []);
  if (mode === 'sample' && allLinks.length > maxProducts) {
    allLinks = allLinks.slice(0, maxProducts);
  }
  
  logInfo(`Total input links: ${allLinks.length} (Mode: ${mode})`);

  let state = loadCrawlState();
  state.total_links = allLinks.length;
  state.crawl_mode = mode;
  saveCrawlState(state);

  let toCrawl = allLinks;
  if (resume) {
    toCrawl = allLinks.filter(l => !isCompleted(l.product_url));
    logInfo(`Resuming: ${allLinks.length - toCrawl.length} completed. Remaining to crawl: ${toCrawl.length}`);
  }

  if (toCrawl.length === 0) {
    logInfo('No links to crawl. Exiting.');
    return;
  }

  logInfo(`Launching browser (headless: ${headlessEnv})`);
  const browser = await chromium.launch({ headless: headlessEnv });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['font', 'media'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  for (let i = 0; i < toCrawl.length; i++) {
    const link = toCrawl[i];

    if (resume && isCompleted(link.product_url)) {
       updateProgress(state, 'skipped');
       continue;
    }

    logInfo(`[${i+1}/${toCrawl.length}] Crawling product: ${link.product_url}`);
    
    try {
      const details = await crawlSingleProduct(page, link);
      writeProductToBatch(link.category_code, details, batchSize);
      markCompleted(link.product_url);
      updateProgress(state, 'success', link.category_code, getCurrentBatchIndex());
      
    } catch (err: any) {
      logError(`Failed to extract ${link.product_url}`, err);
      let reason = 'UNKNOWN_ERROR';
      if (err.message.includes('HTTP Error')) reason = 'HTTP_ERROR';
      else if (err.message.includes('REDIRECTED')) reason = 'REDIRECTED_TO_NON_PRODUCT_PAGE';
      else if (err.message.includes('INVALID_PRODUCT_PAGE')) reason = 'INVALID_PRODUCT_PAGE';
      
      markFailed(link.product_url, link.category_code, err.message, link.category_name, reason);
      updateProgress(state, 'failed', link.category_code, getCurrentBatchIndex());
    }

    if (i < toCrawl.length - 1) {
       await randomDelay(minDelay, maxDelay);
    }
  }

  flushBatch();

  await browser.close();

  logInfo('=== Details Collection Summary ===');
  logInfo(`Total Processed (Success + Failed): ${state.completed + state.failed}`);
  logInfo(`Total Success: ${state.completed}`);
  logInfo(`Total Failed: ${state.failed}`);
  logInfo(`Total Skipped: ${state.skipped}`);
  logInfo('=== End Step 03 ===');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    logError('Fatal error in collect:details', err);
    process.exit(1);
  });
}
