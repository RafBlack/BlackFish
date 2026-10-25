export const FORM_BRANDING_ENABLED = false;
export const FORM_BRANDING_LIMITS = Object.freeze({ elements: 100, characters: 1000, nodes: 400, ancestors: 8, references: 8 });
const excluded = new Set(['script','style','template','input','textarea','select','option']);
function boundedContent(root, visible) {
  const elements = [], text = [];
  let characters = 0, nodes = 0;
  const walker = root.ownerDocument.createTreeWalker(root, 5, {
    acceptNode: node => node.nodeType === 3 && excluded.has(node.parentElement?.localName) ? 2 : 1
  });
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (++nodes > FORM_BRANDING_LIMITS.nodes) return null;
    if (node.nodeType === 1) {
      if (elements.length === FORM_BRANDING_LIMITS.elements) return null;
      elements.push(node);
    } else if (node.nodeType === 3) {
      characters += node.data.length;
      if (characters > FORM_BRANDING_LIMITS.characters) return null;
      if (visible(node.parentElement)) text.push(node.data);
    }
  }
  return { elements, text: text.join(' ') };
}
function displayed(el, visible) {
  if (!el || !visible(el)) return false;
  let depth = 0;
  for (let parent = el.parentElement || el.getRootNode().host; parent; parent = parent.parentElement || parent.getRootNode().host) {
    if (++depth > FORM_BRANDING_LIMITS.elements) return false;
    if (parent.ownerDocument.defaultView.getComputedStyle(parent).opacity === '0') return false;
  }
  return true;
}
export function formBrandText(form, visible, credentialForm) {
  const names = [];
  let characters = 0, context = form;
  const add = value => {
    if (!value || characters + value.length > FORM_BRANDING_LIMITS.characters) return;
    characters += value.length; names.push(value);
  };
  const parent = node => node.parentElement || (node.nodeType !== 11 && node.getRootNode().host ? node.getRootNode() : null);
  for (let depth = 0; context && depth < FORM_BRANDING_LIMITS.ancestors; depth++, context = parent(context)) {
    if (['html','body','main'].includes(context.localName)) break;
    const content = boundedContent(context, el => displayed(el, visible));
    if (!content || content.elements.filter(el => el.localName === 'form' && credentialForm(el)).length !== 1) break;
    for (const el of content.elements) {
      if (!displayed(el, visible)) continue;
      if (/^h[1-6]$/.test(el.localName) || el.localName === 'legend') add(boundedContent(el, node => displayed(node, visible))?.text);
      if (el !== form && el.localName !== 'fieldset') continue;
      add(el.getAttribute('aria-label'));
      const references = (el.getAttribute('aria-labelledby') || '').slice(0, FORM_BRANDING_LIMITS.characters).split(/\s+/).slice(0, FORM_BRANDING_LIMITS.references);
      for (const id of references) {
        const label = el.getRootNode().getElementById?.(id);
        if (label && displayed(label, visible)) add(boundedContent(label, node => displayed(node, visible))?.text);
      }
    }
    if (names.length) break;
  }
  return names.join(' ');
}
