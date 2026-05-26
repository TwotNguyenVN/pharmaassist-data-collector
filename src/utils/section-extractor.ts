import { normalizeVietnameseText } from './text-cleaner.js';

const IGNORED_HEADINGS = [
  'đánh giá sản phẩm',
  'hỏi đáp',
  'bình luận',
  'câu hỏi thường gặp'
];

export function normalizeHeading(text: string | null | undefined): string {
  if (!text) return '';
  return normalizeVietnameseText(text).toLowerCase();
}

function isIgnoredHeading(heading: string): boolean {
  const normHeading = normalizeHeading(heading);
  return IGNORED_HEADINGS.some(ignored => normHeading.includes(ignored));
}

export function extractSectionByHeading(fullText: string | null | undefined, heading: string): string | null {
  if (!fullText || !heading) return null;
  
  const normHeading = normalizeHeading(heading);
  if (isIgnoredHeading(normHeading)) return null;

  const lines = fullText.split('\n');
  let capturing = false;
  let content = [];
  
  for (const line of lines) {
    const normLine = normalizeHeading(line);
    if (normLine.includes(normHeading)) {
      capturing = true;
      continue;
    }
    
    if (capturing) {
      // Stop capturing if we hit another possible heading (naive approach)
      if (line.trim().length > 0 && line.trim().length < 50 && (line.trim().endsWith(':') || line === line.toUpperCase())) {
        break;
      }
      content.push(line);
    }
  }
  
  const extracted = content.join('\n').trim();
  return extracted.length > 0 ? extracted : null;
}

export function extractMultipleSections(fullText: string | null | undefined, headingList: string[]): Record<string, string | null> {
  const results: Record<string, string | null> = {};
  for (const heading of headingList) {
    results[heading] = extractSectionByHeading(fullText, heading);
  }
  return results;
}
