import * as fs from 'node:fs';
import * as path from 'node:path';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Error reading JSON from ${filePath}:`, error);
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing JSON to ${filePath}:`, error);
  }
}

export function appendJsonArray<T>(filePath: string, items: T[]): void {
  try {
    const existing = readJson<T[]>(filePath, []);
    const merged = [...existing, ...items];
    writeJson(filePath, merged);
  } catch (error) {
    console.error(`Error appending JSON array to ${filePath}:`, error);
  }
}

export function writeCsv(filePath: string, rows: string[]): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, rows.join('\n'), 'utf-8');
  } catch (error) {
    console.error(`Error writing CSV to ${filePath}:`, error);
  }
}

export function appendLog(filePath: string, message: string): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, message + '\n', 'utf-8');
  } catch (error) {
    console.error(`Error appending log to ${filePath}:`, error);
  }
}

export function listFilesRecursive(dirPath: string, extension: string): string[] {
  let results: string[] = [];
  try {
    if (!fs.existsSync(dirPath)) return results;
    const list = fs.readdirSync(dirPath);
    for (const file of list) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(listFilesRecursive(fullPath, extension));
      } else {
        if (fullPath.endsWith(extension)) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error listing files in ${dirPath}:`, error);
  }
  return results;
}
