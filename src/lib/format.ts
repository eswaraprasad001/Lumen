/**
 * Decodes common HTML entities and strips invisible filler characters.
 * Useful for cleaning up raw newsletter snippets before rendering them in React.
 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return "";
  
  return text
    // Common HTML entities
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Invisible/filler Unicode characters that break layouts
    .replace(/[\u00AD\u034F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
}
