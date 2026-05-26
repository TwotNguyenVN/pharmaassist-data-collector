/**
 * Step 06: Retry Failed URLs
 */

import { chromium } from 'playwright';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

import { readJson } from './utils/file.js';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { randomDelay } from './utils/delay.js';
import { loadCrawlState, saveCrawlState, markCompleted, markFailed, getFailedUrls, removeFromFailed, updateProgress } from './utils/checkpoint.js';
import { writeProductToBatch, flushBatch, getCurrentBatchIndex } from './utils/batch-writer.js';
import { crawlSingleProduct, type ProductLinkRaw } from './utils/crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');
const RETRY_FAILED_LIMIT = 3;

async function main(): Promise<void> {
  logInfo('=== Step 06: Retry Failed URLs ===');

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

  const headlessEnv = process.env.HEADLESS !== 'false';
  const minDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MIN_MS ?? '2000', 10);
  const maxDelay = parseInt(process.env.REQUEST_DELAY_RANDOM_MAX_MS ?? '5000', 10);
  const batchSize = parseInt(process.env.BATCH_SIZE ?? '100', 10);

  const failedUrls = getFailedUrls();
  const toRetry = failedUrls.filter(f => f.retry_count < RETRY_FAILED_LIMIT);

  if (toRetry.length === 0) {
    logInfo('No failed URLs to retry. Exiting.');
    return;
  }

  logInfo(`Found ${toRetry.length} URLs to retry.`);

  const linksPath = path.join(ROOT_DIR, 'data/raw/product_links.raw.json');
  const allLinks = readJson<ProductLinkRaw[]>(linksPath, []);
  const linksMap = new Map<string, ProductLinkRaw>();
  for (const link of allLinks) {
    linksMap.set(link.product_url, link);
  }

  let state = loadCrawlState();

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

  let successCount = 0;
  let stillFailedCount = 0;

  for (let i = 0; i < toRetry.length; i++) {
    const failedItem = toRetry[i];
    const linkRaw = linksMap.get(failedItem.product_url);
    
    if (!linkRaw) {
      logWarn(`Link raw data not found for ${failedItem.product_url}, skipping...`);
      continue;
    }

    logInfo(`[${i+1}/${toRetry.length}] Retrying product: ${failedItem.product_url} (Attempt ${failedItem.retry_count + 1})`);
    
    try {
      const details = await crawlSingleProduct(page, linkRaw);
      
      writeProductToBatch(linkRaw.category_code, details, batchSize);
      markCompleted(linkRaw.product_url);
      removeFromFailed(linkRaw.product_url);
      updateProgress(state, 'success', linkRaw.category_code, getCurrentBatchIndex());
      
      successCount++;
      logInfo(`Successfully recovered: ${linkRaw.product_url}`);
    } catch (err: any) {
      logError(`Retry failed for ${linkRaw.product_url}`, err);
      let reason = 'UNKNOWN_ERROR';
      if (err.message.includes('HTTP Error')) reason = 'HTTP_ERROR';
      else if (err.message.includes('REDIRECTED')) reason = 'REDIRECTED_TO_NON_PRODUCT_PAGE';
      else if (err.message.includes('INVALID_PRODUCT_PAGE')) reason = 'INVALID_PRODUCT_PAGE';
      
      markFailed(linkRaw.product_url, linkRaw.category_code, err.message, linkRaw.category_name, reason);
      updateProgress(state, 'failed', linkRaw.category_code, getCurrentBatchIndex());
      stillFailedCount++;
    }

    if (i < toRetry.length - 1) {
       await randomDelay(minDelay, maxDelay);
    }
  }

  flushBatch();
  await browser.close();

  logInfo('=== Retry Summary ===');
  logInfo(`Total Retried: ${toRetry.length}`);
  logInfo(`Recovered (Success): ${successCount}`);
  logInfo(`Still Failed: ${stillFailedCount}`);
  logInfo('=== End Step 06 ===');
}

main().catch((err) => {
  logError('Fatal error in retry:failed', err);
  process.exit(1);
});
