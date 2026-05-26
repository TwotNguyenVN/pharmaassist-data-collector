import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');
const STATE_DIR = path.join(ROOT_DIR, 'data/state');
const PRODUCTS_DIR = path.join(ROOT_DIR, 'data/raw/products');

const COMPLETED_URLS_FILE = path.join(STATE_DIR, 'completed_urls.json');
const CRAWL_STATE_FILE = path.join(STATE_DIR, 'crawl_state.json');

function listFilesRecursive(dir: string, ext: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(listFilesRecursive(filePath, ext));
    } else if (file.endsWith(ext)) {
      results.push(filePath);
    }
  }
  return results;
}

function main() {
  console.log('=== Checking checkpoint integrity ===');

  if (!fs.existsSync(COMPLETED_URLS_FILE)) {
    console.log('No completed_urls.json found. Nothing to recover.');
    return;
  }

  const completedUrls: string[] = JSON.parse(fs.readFileSync(COMPLETED_URLS_FILE, 'utf-8'));
  console.log(`Total URLs in completed_urls.json: ${completedUrls.length}`);

  // Scan all saved products in data/raw/products
  const batchFiles = listFilesRecursive(PRODUCTS_DIR, '.json');
  console.log(`Found ${batchFiles.length} batch JSON files in ${PRODUCTS_DIR}`);

  const savedUrls = new Set<string>();
  for (const file of batchFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const products = JSON.parse(content);
      if (Array.isArray(products)) {
        for (const p of products) {
          if (p.source && p.source.source_url) {
            savedUrls.add(p.source.source_url);
          }
        }
      }
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
    }
  }
  console.log(`Total unique product URLs saved in batch files: ${savedUrls.size}`);

  // Find completed URLs that are NOT saved in batch files
  const missingUrls = completedUrls.filter(url => !savedUrls.has(url));
  console.log(`Found ${missingUrls.length} URLs marked as completed but NOT saved in any batch file.`);

  if (missingUrls.length > 0) {
    console.log('\nSample missing URLs:');
    missingUrls.slice(0, 5).forEach(url => console.log(`- ${url}`));

    // Remove missing URLs from completed_urls.json
    const recoveredUrls = completedUrls.filter(url => savedUrls.has(url));
    fs.writeFileSync(COMPLETED_URLS_FILE, JSON.stringify(recoveredUrls, null, 2), 'utf-8');
    console.log(`\nUpdated completed_urls.json. New size: ${recoveredUrls.length} (Removed ${missingUrls.length} missing URLs).`);

    // Also update crawl_state.json completed count
    if (fs.existsSync(CRAWL_STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(CRAWL_STATE_FILE, 'utf-8'));
        state.completed = recoveredUrls.length;
        fs.writeFileSync(CRAWL_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
        console.log(`Updated crawl_state.json completed count to ${recoveredUrls.length}`);
      } catch (e) {
        console.error('Error updating crawl_state.json:', e);
      }
    }
  } else {
    console.log('\nAll completed URLs are correctly saved on disk. No recovery needed!');
  }
}

main();
