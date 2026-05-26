import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog } from './file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const COLLECT_LOG = path.join(LOGS_DIR, 'collect.log');
const ERRORS_LOG = path.join(LOGS_DIR, 'errors.log');

function timestamp(): string {
  return new Date().toISOString();
}

export function logInfo(message: string): void {
  const formatted = `[${timestamp()}] [INFO] ${message}`;
  console.log(formatted);
  appendLog(COLLECT_LOG, formatted);
}

export function logWarn(message: string): void {
  const formatted = `[${timestamp()}] [WARN] ${message}`;
  console.warn(formatted);
  appendLog(COLLECT_LOG, formatted);
}

export function logError(message: string, error?: unknown): void {
  const errorDetail = error instanceof Error ? ` | ${error.message}\n${error.stack}` : (error ? ` | ${String(error)}` : '');
  const formatted = `[${timestamp()}] [ERROR] ${message}${errorDetail}`;
  console.error(formatted);
  appendLog(COLLECT_LOG, formatted);
  appendLog(ERRORS_LOG, formatted);
}
