// The contact form (src/pages.mjs contactForm): preselects the topic a button linked to
// (`?topic=pricing#contact-form`), tells the server how long the page was open before sending (a
// bot posting within seconds is dropped, api site-contact.controller.ts), and sends the form in the
// background: the button says it is sending and can't be pressed twice, then the thank-you or error
// page opens. Without this script the form is posted as usual. A request that gets no readable answer
// goes to the error page (it names the address to write to) rather than being posted again: the mail
// may have been sent.
const form = document.getElementById('contact-form');
if (form) {
  const opened = Date.now();
  const field = (name) => form.elements.namedItem(name);
  const topic = new URLSearchParams(location.search).get('topic');
  const select = field('topic');
  if (topic && select && [...select.options].some((o) => o.value === topic)) select.value = topic;

  const button = form.querySelector('button[type=submit]');
  let sending = false;
  form.addEventListener('submit', async (event) => {
    field('elapsed').value = String(Date.now() - opened);
    if (!window.fetch || !window.AbortController) return; // plain post
    event.preventDefault();
    if (sending) return;
    sending = true;
    button.disabled = true;
    button.textContent = button.dataset.sending || button.textContent;
    form.setAttribute('aria-busy', 'true');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    let result;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
        signal: abort.signal,
      });
      result = await res.json();
    } catch {
      result = null;
    } finally {
      clearTimeout(timer);
    }
    location.assign(field(result && result.ok === true ? 'ok' : 'fail').value);
  });
}
