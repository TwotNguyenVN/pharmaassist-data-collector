export function parseVietnamesePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  
  // Extract only digits
  const numericString = text.replace(/[^\d]/g, '');
  if (!numericString) return null;
  
  const parsed = parseInt(numericString, 10);
  return isNaN(parsed) ? null : parsed;
}
