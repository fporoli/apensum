// The website's chatbot (src/layout.mjs adds it when the site has the API's address, SITE_CONTACT_URL): a button that
// opens a small chat. Questions go to the API's public/chat, which answers from this website's texts only (an AI on
// Azure OpenAI in Switzerland); "Talk to a person" sends name, e-mail, message and the conversation to public/chat/handover
// (a mail to Apensum). Messages are put in as text, never as HTML. The conversation stays in this tab
// (sessionStorage) so it survives a page change; the API keeps nothing of it.
(() => {
  const script = document.currentScript;
  if (!script || !script.dataset.api) return;
  const api = script.dataset.api;
  const lang = script.dataset.lang || 'de';
  let t = {};
  try {
    t = JSON.parse(script.dataset.texts || '{}');
  } catch {
    return;
  }
  const KEY = 'apensum-chat';
  const load = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return v && Array.isArray(v.messages) ? v : null;
    } catch {
      return null;
    }
  };
  const state = load() || { open: false, messages: [] };
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private window: the chat just starts over on the next page */
    }
  };

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  const launcher = el('button', { class: 'chat-launcher', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'chat-panel' },
    el('span', { class: 'chat-launcher-dot', 'aria-hidden': 'true' }), el('span', { text: t.open }));
  const log = el('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = el('textarea', { class: 'chat-input', rows: '2', maxlength: '800', placeholder: t.placeholder, 'aria-label': t.placeholder });
  const sendBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'submit', text: t.send });
  const form = el('form', { class: 'chat-form' }, input, sendBtn);
  const personBtn = el('button', { class: 'chat-link', type: 'button', text: t.person });
  const handover = el('form', { class: 'chat-handover', hidden: '' });
  const panel = el('section', { class: 'chat-panel', id: 'chat-panel', role: 'dialog', 'aria-label': t.title, hidden: '' },
    el('header', { class: 'chat-head' },
      el('div', {}, el('strong', { text: t.title }), el('p', { class: 'chat-sub', text: t.subtitle })),
      el('button', { class: 'chat-close', type: 'button', 'aria-label': t.close, text: '×', onclick: () => toggle(false) })),
    log, handover, form,
    el('footer', { class: 'chat-foot' }, personBtn, el('a', { href: script.dataset.about || '#', text: t.about })));
  document.body.append(launcher, panel);

  const bubble = (role, text) => el('p', { class: `chat-msg chat-${role}`, text });
  const render = () => {
    log.replaceChildren(bubble('assistant', t.greeting), ...state.messages.map((m) => bubble(m.role, m.content)));
    log.scrollTop = log.scrollHeight;
  };
  const toggle = (open) => {
    state.open = open;
    save();
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.hidden = open;
    if (open) {
      render();
      input.focus();
    } else launcher.focus();
  };
  launcher.addEventListener('click', () => toggle(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) toggle(false);
  });

  const post = async (path, body) => {
    const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  };
  const errorText = (code) => t[`error_${code}`] || t.error_failed;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question || sendBtn.disabled) return;
    state.messages.push({ role: 'user', content: question });
    input.value = '';
    sendBtn.disabled = true;
    render();
    const thinking = bubble('assistant', t.thinking);
    thinking.classList.add('chat-thinking');
    log.append(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const data = await post('', { lang, messages: state.messages.slice(-10) });
      if (data && data.ok && data.answer) state.messages.push({ role: 'assistant', content: data.answer });
      else state.messages.push({ role: 'assistant', content: errorText(data && data.error) });
    } catch {
      state.messages.push({ role: 'assistant', content: t.error_failed });
    }
    sendBtn.disabled = false;
    save();
    render();
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Talk to a person: name, e-mail and the message (the last question as a start), with the conversation.
  personBtn.addEventListener('click', () => {
    const last = [...state.messages].reverse().find((m) => m.role === 'user');
    const field = (name, label, { tag = 'input', ...attrs }) => el('label', { class: 'chat-field' }, el('span', { text: label }), el(tag, { name, ...attrs }));
    handover.replaceChildren(
      el('p', { text: t.personIntro }),
      field('name', t.name, { required: '', maxlength: '120', autocomplete: 'name' }),
      field('email', t.email, { type: 'email', required: '', maxlength: '200', autocomplete: 'email' }),
      field('message', t.message, { tag: 'textarea', rows: '3', required: '', maxlength: '3000' }),
      // A field people don't see: a bot that fills it in sends nothing.
      el('input', { name: 'website', class: 'chat-hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
      el('div', { class: 'chat-actions' },
        el('button', { class: 'btn btn-primary btn-sm', type: 'submit', text: t.submit }),
        el('button', { class: 'chat-link', type: 'button', text: t.back, onclick: () => { handover.hidden = true; form.hidden = false; } })),
    );
    if (last) handover.querySelector('[name="message"]').value = last.content;
    handover.hidden = false;
    form.hidden = true;
    handover.querySelector('[name="name"]').focus();
  });
  handover.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(handover));
    const button = handover.querySelector('button[type="submit"]');
    button.disabled = true;
    let result;
    try {
      result = await post('/handover', { lang, ...data, messages: state.messages.slice(-10) });
    } catch {
      result = { ok: false, error: 'failed' };
    }
    button.disabled = false;
    if (result && result.ok) {
      state.messages.push({ role: 'assistant', content: t.handed });
      save();
      handover.hidden = true;
      form.hidden = false;
      render();
    } else {
      const old = handover.querySelector('.chat-error');
      if (old) old.remove();
      handover.prepend(el('p', { class: 'chat-error', role: 'alert', text: errorText(result && result.error) }));
    }
  });

  if (state.open) toggle(true);
})();
