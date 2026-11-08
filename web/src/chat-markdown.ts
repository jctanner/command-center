import { highlightChatCode } from './chat-code';
import { markdownContent } from './markdown';

export function chatMarkdown(text: string): HTMLElement {
  const body = document.createElement('div'); body.className = 'agent-markdown';
  body.append(markdownContent(text, ['input', 'select', 'textarea', 'option']));
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href') || '';
    // File paths and fragments have no reliable base in a chat; never let them
    // become workspace routes or requests against CC's own API.
    if (!/^(https?:|mailto:)/i.test(href)) { link.removeAttribute('href'); continue; }
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  for (const table of body.querySelectorAll('table')) {
    const scroll = document.createElement('div'); scroll.className = 'chat-table-scroll';
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Message table');
    table.replaceWith(scroll); scroll.append(table);
  }
  for (const pre of body.querySelectorAll('pre')) {
    pre.tabIndex = 0;
    const wrapper = document.createElement('div'); wrapper.className = 'chat-code-block';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.className = 'chat-code-copy'; copy.setAttribute('aria-label', 'Copy code');
    copy.onclick = async () => {
      const text = pre.querySelector('code')?.textContent || pre.textContent || '';
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { const range = document.createRange(); range.selectNodeContents(pre); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); copy.textContent = 'Select and copy'; }
    };
    pre.replaceWith(wrapper); wrapper.append(copy, pre);
  }
  highlightChatCode(body);
  return body;
}
