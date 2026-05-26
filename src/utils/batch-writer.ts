import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, ensureDir, listFilesRecursive } from './file.js';
import type { ProductRaw } from '../types/product-raw.type.js';
import { logInfo } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../../data/raw/products');

let currentBatch: ProductRaw[] = [];
let currentCategoryCode: string | null = null;
let currentBatchIndex = 0;

export function getCurrentBatchIndex(): number {
  return currentBatchIndex;
}

export function getNextBatchIndex(categoryCode: string): number {
  const catSafe = categoryCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  const catDir = path.join(OUTPUT_DIR, catSafe);
  ensureDir(catDir);
  // find highest batch index
  const files = listFilesRecursive(catDir, '.json');
  return files.length + 1;
}

export function flushBatch(): void {
  if (currentBatch.length === 0 || !currentCategoryCode) return;
  
  const catSafe = currentCategoryCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  const catDir = path.join(OUTPUT_DIR, catSafe);
  ensureDir(catDir);
  
  const batchFile = path.join(catDir, `batch_${String(currentBatchIndex).padStart(3, '0')}.json`);
  writeJson(batchFile, currentBatch);
  
  logInfo(`Flushed batch ${currentBatchIndex} with ${currentBatch.length} products to ${batchFile}`);
  
  currentBatch = [];
}

export function writeProductToBatch(categoryCode: string, product: ProductRaw, batchSize: number): void {
  if (currentCategoryCode !== categoryCode) {
    if (currentBatch.length > 0) flushBatch();
    currentCategoryCode = categoryCode;
    currentBatchIndex = getNextBatchIndex(categoryCode);
  }
  
  currentBatch.push(product);
  
  if (currentBatch.length >= batchSize) {
    flushBatch();
    currentBatchIndex++;
  }
}
