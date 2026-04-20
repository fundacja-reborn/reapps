/**
 * Markdown content sanitizer for import and editor input.
 *
 * Strips potentially dangerous content:
 *  - Base64 data URI images (`![alt](data:...)`)
 *  - Dangerous HTML tags (`<script>`, `<iframe>`, etc.)
 *  - Unsafe URI schemes in links (`javascript:`, `vbscript:`, `data:text/html`)
 */

/** Check whether a URL string is a data URI. */
export function isDataUri(url: string): boolean {
  return url.trim().toLowerCase().startsWith('data:');
}

/** Replace markdown image syntax with data URIs: `![alt](data:...)` → `![alt]()` */
export function stripBase64Images(markdown: string): { result: string; count: number } {
  let count = 0;
  const result = markdown.replace(/!\[[^\]]*\]\(data:[^)]+\)/gi, (match) => {
    count++;
    // Preserve alt text
    const altMatch = match.match(/^!\[([^\]]*)\]/);
    const alt = altMatch ? altMatch[1] : '';
    return `![${alt}]()`;
  });
  return { result, count };
}

/** Remove dangerous HTML tags from markdown content. */
export function stripHtmlTags(markdown: string): { result: string; count: number } {
  let count = 0;
  const DANGEROUS_TAGS = 'script|iframe|object|embed|form|input|style|link';

  // Match paired tags: <script ...>...</script>
  const pairedRegex = new RegExp(
    `<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
    'gi'
  );
  let result = markdown.replace(pairedRegex, () => {
    count++;
    return '';
  });

  // Match self-closing / unpaired tags: <script ... /> or <script ...>
  const selfClosingRegex = new RegExp(
    `<(${DANGEROUS_TAGS})\\b[^>]*/?>`,
    'gi'
  );
  result = result.replace(selfClosingRegex, () => {
    count++;
    return '';
  });

  return { result, count };
}

/** Replace links with unsafe URI schemes: `[text](javascript:...)` → `[text]()` */
export function stripJavascriptUris(markdown: string): { result: string; count: number } {
  let count = 0;
  const result = markdown.replace(
    /\[([^\]]*)\]\((javascript|vbscript|data:text\/html):[^)]*\)/gi,
    (_match, text) => {
      count++;
      return `[${text}]()`;
    }
  );
  return { result, count };
}

export type SanitizeResult = {
  sanitized: string;
  stripped: string[];
};

/**
 * Sanitize markdown content by removing dangerous elements.
 * Returns the cleaned content and a list of what was removed.
 */
export function sanitizeMarkdownContent(markdown: string): SanitizeResult {
  const stripped: string[] = [];

  const base64 = stripBase64Images(markdown);
  if (base64.count > 0) {
    stripped.push(`base64 images: ${base64.count}`);
  }

  const html = stripHtmlTags(base64.result);
  if (html.count > 0) {
    stripped.push(`HTML tags: ${html.count}`);
  }

  const uris = stripJavascriptUris(html.result);
  if (uris.count > 0) {
    stripped.push(`unsafe URIs: ${uris.count}`);
  }

  return { sanitized: uris.result, stripped };
}

/** Max allowed tag length (aligned with type constraints). */
const MAX_TAG_LENGTH = 100;

/** Regex for safe tag characters: alphanumeric, space, hyphen, underscore, common accented letters. */
const SAFE_TAG_RE = /^[\w\s\-\u00C0-\u024F]+$/u;

/**
 * Sanitize a list of tags from frontmatter.
 * Trims, enforces length limit, and rejects tags with HTML/script content.
 */
export function sanitizeTags(tags: string[]): { sanitized: string[]; rejected: number } {
  let rejected = 0;
  const sanitized: string[] = [];

  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      rejected++;
      continue;
    }
    if (!SAFE_TAG_RE.test(tag)) {
      rejected++;
      continue;
    }
    sanitized.push(tag);
  }

  return { sanitized, rejected };
}
