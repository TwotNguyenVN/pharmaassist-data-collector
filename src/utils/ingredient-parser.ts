export interface ParsedIngredient {
  raw_text: string;
  name: string | null;
  strength: string | null;
}

export function parseIngredients(text: string | null | undefined): ParsedIngredient[] {
  if (!text) return [];
  
  // Simple split by commas or semicolons
  const parts = text.split(/[,;]/).map(p => p.trim()).filter(Boolean);
  
  return parts.map(part => {
    // Try to match pattern "Name (Strength)"
    // e.g. "Paracetamol (500mg)"
    const match = part.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      return {
        raw_text: part,
        name: match[1].trim(),
        strength: match[2].trim()
      };
    }
    
    // Pattern without parentheses but with numbers at the end
    // e.g. "Paracetamol 500mg"
    const match2 = part.match(/^(.*?)\s+(\d+[\.,]?\d*\s*(?:mg|g|ml|mcg|iu|ui|%|µg)(?:\/\w+)?)$/i);
    if (match2) {
      return {
        raw_text: part,
        name: match2[1].trim(),
        strength: match2[2].trim()
      };
    }

    return {
      raw_text: part,
      name: part,
      strength: null
    };
  });
}
