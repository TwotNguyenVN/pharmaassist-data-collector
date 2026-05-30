import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

import { readJson, writeJson, listFilesRecursive } from './utils/file.js';
import { logInfo, logError, logWarn } from './utils/logger.js';
import { randomDelay } from './utils/delay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');
const RAW_DIR = path.join(ROOT_DIR, 'data/raw/products');

// Configure worker count and delay to be gentle to the server
const CONCURRENCY = 15;
const MIN_DELAY = 500;
const MAX_DELAY = 1200;

interface ProductInfo {
  filePath: string;
  index: number;
  productName: string;
  url: string;
}

async function fetchShelfLife(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.7,en;q=0.3'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (res.status !== 200) {
      logWarn(`HTTP ${res.status} for URL: ${url}`);
      return null;
    }

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
      logWarn(`__NEXT_DATA__ script tag not found for: ${url}`);
      return null;
    }

    const data = JSON.parse(match[1]);
    const expDate = data.props?.pageProps?.product?.expirationDate;
    return expDate || null;
  } catch (e: any) {
    logError(`Error fetching URL: ${url}`, e.message);
    return null;
  }
}

async function main() {
  logInfo('=== Step 08: Enrich Shelf Life Data ===');
  
  if (!fs.existsSync(RAW_DIR)) {
    logError(`Directory not found: ${RAW_DIR}`);
    return;
  }

  const allFiles = listFilesRecursive(RAW_DIR, '.json');
  logInfo(`Found ${allFiles.length} raw batch files.`);

  // Find all medicines that have null shelf_life_text
  const queue: ProductInfo[] = [];
  let totalMedicines = 0;
  let alreadyHasShelfLife = 0;

  for (const file of allFiles) {
    const products = readJson<any[]>(file, []);
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const isMedicine = p.medicine?.is_medicine || p.basic?.product_type === 'MEDICINE';
      if (isMedicine) {
        totalMedicines++;
        if (p.medicine?.shelf_life_text !== null && p.medicine?.shelf_life_text !== undefined) {
          alreadyHasShelfLife++;
        } else {
          queue.push({
            filePath: file,
            index: i,
            productName: p.basic?.product_name || 'Unknown Product',
            url: p.source?.source_url
          });
        }
      }
    }
  }

  logInfo(`Total Medicines in dataset: ${totalMedicines}`);
  logInfo(`Already has shelf life: ${alreadyHasShelfLife}`);
  logInfo(`Missing shelf life to enrich: ${queue.length}`);

  if (queue.length === 0) {
    logInfo('No missing shelf life data found. All medicines are already enriched!');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let processedCount = 0;

  // Simple concurrency worker pool
  const worker = async (workerId: number) => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      processedCount++;
      logInfo(`[Worker ${workerId}] [${processedCount}/${queue.length + processedCount}] Fetching: ${item.productName}`);
      
      const expDate = await fetchShelfLife(item.url);
      
      if (expDate) {
        successCount++;
        // Update raw JSON batch file immediately
        const products = readJson<any[]>(item.filePath, []);
        if (products[item.index]) {
          products[item.index].medicine.shelf_life_text = expDate;
          products[item.index].medicine.shelf_life_months = parseInt(expDate.replace(/[^\d]/g, ''), 10) || null;
          writeJson(item.filePath, products);
          logInfo(`[Worker ${workerId}] Success -> ${expDate} for ${item.productName}`);
        }
      } else {
        failCount++;
        logWarn(`[Worker ${workerId}] Failed to get shelf life for ${item.productName}`);
      }

      // Respectful delay between requests
      await randomDelay(MIN_DELAY, MAX_DELAY);
    }
  };

  logInfo(`Starting worker pool with ${CONCURRENCY} concurrent requests...`);
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  logInfo('=== Step 08 Enrichment Completed ===');
  logInfo(`Total Processed: ${processedCount}`);
  logInfo(`Enriched successfully: ${successCount}`);
  logInfo(`Failed: ${failCount}`);
}

main().catch(err => {
  logError('Fatal error in Step 08', err);
  process.exit(1);
});
