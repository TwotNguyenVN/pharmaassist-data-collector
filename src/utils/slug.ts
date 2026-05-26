import slugify from 'slugify';

export function toSlug(input: string): string {
  if (!input) return '';
  return slugify(input, {
    lower: true,
    strict: true,
    locale: 'vi',
    trim: true,
    replacement: '-'
  });
}
