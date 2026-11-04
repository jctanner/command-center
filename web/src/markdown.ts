import { marked } from 'marked';
import DOMPurify from 'dompurify';

const slug = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
export function markdownContent(text: string, extraForbidden: string[] = []): DocumentFragment {
  const html = marked.parse(text.replace(/^\uFEFF/, ''), { async: false, gfm: true });
  const content = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'style', 'form', 'button', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'link', 'meta', ...extraForbidden],
    FORBID_ATTR: ['style', 'src', 'srcset', 'id', 'name', 'autofocus'],
  });
  for (const input of content.querySelectorAll('input')) { if (input.type === 'checkbox') input.disabled = true; else input.remove(); }
  return content;
}
export function renderMarkdown(text: string, path: string, openFile: (path: string) => void): DocumentFragment {
  const content = markdownContent(text);
  const outline = document.createElement('details'); outline.className = 'markdown-outline'; outline.open = !window.matchMedia('(max-width: 760px)').matches;
  const summary = document.createElement('summary'); summary.setAttribute('aria-label', 'Table of contents'); summary.title = 'Toggle table of contents';
  const title = document.createElement('span'); title.textContent = 'Table of contents'; summary.append(title); outline.append(summary);
  const toc = document.createElement('nav'); toc.setAttribute('aria-label', 'Table of contents'); outline.append(toc);
  const anchors = new Map<string, HTMLElement>();
  const headings = content.querySelectorAll<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6');
  headings.forEach((heading, index) => {
    const label = heading.textContent || 'Section', base = slug(label); heading.id = `markdown-heading-${index}`;
    if (!anchors.has(base)) anchors.set(base, heading);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.style.paddingLeft = `${8 + (Number(heading.tagName[1]) - 1) * 12}px`;
    button.onclick = () => heading.scrollIntoView({ block: 'start' }); toc.append(button);
  });
  for (const link of content.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href'); if (!href) continue;
    if (href.startsWith('#')) {
      link.onclick = event => { event.preventDefault(); let fragment = href.slice(1); try { fragment = decodeURIComponent(fragment); } catch { /* malformed escape stays literal */ } anchors.get(slug(fragment))?.scrollIntoView({ block: 'start' }); };
    } else if (/^(https?:|mailto:)/i.test(href) || href.startsWith('//')) {
      link.target = '_blank'; link.rel = 'noopener noreferrer';
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      link.removeAttribute('href');
    } else {
      link.onclick = event => {
        event.preventDefault();
        try {
          const base = `https://files.invalid${path.split('/').map(encodeURIComponent).join('/')}`;
          openFile(decodeURIComponent(new URL(href, base).pathname));
        } catch { /* malformed links cannot become a different filesystem path */ }
      };
    }
  }
  const result = document.createDocumentFragment();
  const layout = document.createElement('div'); layout.className = 'markdown-layout';
  if (headings.length) layout.append(outline);
  const article = document.createElement('article'); article.className = 'markdown-body'; article.append(content); layout.append(article); result.append(layout);
  return result;
}
