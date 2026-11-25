import DOMPurify from 'dompurify';

export function reviewDocument(html: string) {
  const content = DOMPurify.sanitize(html, {
    // Keep the author's stylesheet with its figure when parsing a full document.
    FORCE_BODY: true,
    ALLOWED_TAGS: [
      'style', 'main', 'section', 'header', 'article', 'div', 'p', 'h1', 'h2', 'h3',
      'strong', 'em', 'span', 'details', 'summary', 'figure', 'figcaption', 'img',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'pre', 'code',
      'svg', 'rect', 'circle', 'line', 'polyline', 'text', 'g',
    ],
    ALLOWED_ATTR: [
      'class', 'id', 'style', 'src', 'alt', 'title', 'width', 'height', 'viewBox',
      'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'points', 'fill',
      'stroke', 'stroke-width', 'open',
    ],
  });
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.5 system-ui;color:#18232b}img,svg{max-width:100%;height:auto}summary{cursor:pointer}</style>${content}`;
}
