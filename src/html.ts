import sanitizeHtml from 'sanitize-html';

/** Allowed tags for campaign job descriptions. Nothing else survives. */
const JOB_DESCRIPTION_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'h2', 'h3'],
  allowedAttributes: {},
  allowedSchemes: [],
};

export function sanitizeJobDescription(html: string): string {
  return sanitizeHtml(html ?? '', JOB_DESCRIPTION_OPTIONS).trim();
}

export function jobDescriptionHasText(html: string): boolean {
  const text = sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .trim();
  return text.length > 0;
}

/**
 * Sanitise again at render time. Legacy plain-text JDs (no tags) keep line
 * breaks by converting newlines to <br> first.
 */
export function renderJobDescription(html: string): string {
  const raw = html ?? '';
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  const source = looksLikeHtml ? raw : raw.replace(/\n/g, '<br>');
  return sanitizeJobDescription(source);
}
