import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(__dirname, '../../data/state');
const CRAWL_STATE_FILE = path.join(STATE_DIR, 'crawl_state.json');
const COMPLETED_URLS_FILE = path.join(STATE_DIR, 'completed_urls.json');
const FAILED_URLS_FILE = path.join(STATE_DIR, 'failed_urls.json');

export interface CrawlState {
  started_at: string;
  last_run_at: string;
  total_links: number;
  completed: number;
  failed: number;
  skipped: number;
  current_category: string | null;
  current_batch: number;
  crawl_mode: string;
}

export interface FailedUrl {
  product_url: string;
  category_code: string;
  category_name?: string;
  error_message: string;
  reason?: string;
  failed_at: string;
  retry_count: number;
}

export function loadCrawlState(): CrawlState {
  return readJson<CrawlState>(CRAWL_STATE_FILE, {
    started_at: new Date().toISOString(),
    last_run_at: new Date().toISOString(),
    total_links: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    current_category: null,
    current_batch: 1,
    crawl_mode: 'sample'
  });
}

export function saveCrawlState(state: CrawlState): void {
  state.last_run_at = new Date().toISOString();
  writeJson(CRAWL_STATE_FILE, state);
}

export function markCompleted(url: string): void {
  const completed = readJson<string[]>(COMPLETED_URLS_FILE, []);
  if (!completed.includes(url)) {
    completed.push(url);
    writeJson(COMPLETED_URLS_FILE, completed);
  }
}

export function markFailed(url: string, categoryCode: string, error: string, categoryName?: string, reason?: string): void {
  const failed = readJson<FailedUrl[]>(FAILED_URLS_FILE, []);
  const existing = failed.find(f => f.product_url === url);
  if (existing) {
    existing.error_message = error;
    existing.failed_at = new Date().toISOString();
    existing.retry_count++;
    if (categoryName) existing.category_name = categoryName;
    if (reason) existing.reason = reason;
  } else {
    failed.push({
      product_url: url,
      category_code: categoryCode,
      category_name: categoryName,
      error_message: error,
      reason: reason,
      failed_at: new Date().toISOString(),
      retry_count: 0
    });
  }
  writeJson(FAILED_URLS_FILE, failed);
}

export function isCompleted(url: string): boolean {
  const completed = readJson<string[]>(COMPLETED_URLS_FILE, []);
  return completed.includes(url);
}

export function getFailedUrls(): FailedUrl[] {
  return readJson<FailedUrl[]>(FAILED_URLS_FILE, []);
}

export function removeFromFailed(url: string): void {
  const failed = readJson<FailedUrl[]>(FAILED_URLS_FILE, []);
  const updated = failed.filter(f => f.product_url !== url);
  if (updated.length !== failed.length) {
    writeJson(FAILED_URLS_FILE, updated);
  }
}

export function updateProgress(state: CrawlState, status: 'success' | 'failed' | 'skipped', categoryCode?: string, batchIndex?: number): void {
  if (status === 'success') state.completed++;
  else if (status === 'failed') state.failed++;
  else if (status === 'skipped') state.skipped++;

  if (categoryCode) state.current_category = categoryCode;
  if (batchIndex !== undefined) state.current_batch = batchIndex;
  
  saveCrawlState(state);
}
