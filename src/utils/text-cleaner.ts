export function removeExtraSpaces(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeVietnameseText(text: string | null | undefined): string {
  if (!text) return '';
  return removeExtraSpaces(text).normalize('NFC');
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Basic HTML stripping, replaces tags with space to avoid joining words
  return removeExtraSpaces(html.replace(/<[^>]*>?/gm, ' '));
}

export function cleanPriceText(text: string | null | undefined): string {
  if (!text) return '';
  return removeExtraSpaces(text).toLowerCase();
}

export function cleanSectionText(text: string | null | undefined): string {
  if (!text) return '';
  // Clean up typical section text issues like multiple newlines, html artifacts
  let cleaned = text.replace(/<br\s*\/?>/gi, '\n');
  cleaned = stripHtml(cleaned);
  // Replace multiple newlines with a single newline
  cleaned = cleaned.replace(/\n\s*\n/g, '\n').trim();
  return cleaned;
}

export function truncateLongText(text: string | null | undefined, maxLength: number = 255): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function sanitizeContentHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const trimmed = html.trim();
  if (!trimmed) return null;

  let cleaned = trimmed;

  // 1. Remove script blocks entirely
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 2. Remove style blocks entirely
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // 3. Remove other dangerous/blacklist blocks entirely
  const blacklistTags = ['iframe', 'object', 'embed', 'form', 'button', 'svg', 'link', 'meta'];
  for (const tag of blacklistTags) {
    const reg = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    cleaned = cleaned.replace(reg, '');
    const selfClosingReg = new RegExp(`<${tag}[^>]*>`, 'gi');
    cleaned = cleaned.replace(selfClosingReg, '');
  }

  // 4. Filter all tags: keep only whitelist, sanitize their attributes
  const whitelist = new Set([
    'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'br', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ]);

  cleaned = cleaned.replace(/<(\/?)([a-zA-Z0-9:-]+)([^>]*)>/gi, (match, slash, tagName, attrs) => {
    const tagLower = tagName.toLowerCase();
    if (whitelist.has(tagLower)) {
      if (!slash) {
        // Sanitize attributes: remove onclick, onerror, onload, and javascript: URLs
        let cleanAttrs = attrs;
        
        // Remove event handlers (on*)
        cleanAttrs = cleanAttrs.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        cleanAttrs = cleanAttrs.replace(/\s+on[a-zA-Z]+\b/gi, '');

        // Remove javascript: URLs
        cleanAttrs = cleanAttrs.replace(/\s+[a-zA-Z-]+\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '');

        return `<${tagLower}${cleanAttrs}>`;
      } else {
        return `</${tagLower}>`;
      }
    }
    // Strip tag entirely but keep inner content
    return '';
  });

  return cleaned.trim();
}

export function htmlToPlainText(html: string | null | undefined): string | null {
  if (!html) return null;
  const trimmed = html.trim();
  if (!trimmed) return null;

  let text = trimmed;

  // 1. Remove script blocks entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 2. Remove style blocks entirely
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // 3. Map list items <li> to "- "
  text = text.replace(/<li[^>]*>/gi, '  - ');
  text = text.replace(/<\/li>/gi, '\n');

  // 4. Map block elements and line breaks to newline
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/h2>/gi, '\n');
  text = text.replace(/<\/h3>/gi, '\n');
  text = text.replace(/<\/h4>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');

  // 5. Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 6. Decode HTML entities
  text = text.replace(/&nbsp;/gi, ' ')
             .replace(/&amp;/gi, '&')
             .replace(/&lt;/gi, '<')
             .replace(/&gt;/gi, '>')
             .replace(/&quot;/gi, '"')
             .replace(/&apos;/gi, "'");

  // 7. Clean up whitespace and empty lines
  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  let consecutiveEmpty = 0;

  for (const line of lines) {
    const cleanedLine = line.replace(/[ \t]+/g, ' ').trim();
    if (cleanedLine === '') {
      consecutiveEmpty++;
      if (consecutiveEmpty <= 1) {
        cleanedLines.push('');
      }
    } else {
      consecutiveEmpty = 0;
      cleanedLines.push(cleanedLine);
    }
  }

  return cleanedLines.join('\n').trim();
}

