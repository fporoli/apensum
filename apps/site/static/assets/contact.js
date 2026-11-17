// The contact form (src/pages.mjs contactForm): preselects the topic a button linked to
// (`?topic=pricing#contact-form`) and tells the server how long the page was open before sending,
// so a bot posting within seconds is dropped (api site-contact.controller.ts). Without this
// script the form still works: the topic stays "general" and `elapsed` stays empty.
const form = document.getElementById('contact-form');
if (form) {
  const opened = Date.now();
  const topic = new URLSearchParams(location.search).get('topic');
  const select = form.elements.namedItem('topic');
  if (topic && select && [...select.options].some((o) => o.value === topic)) select.value = topic;
  form.addEventListener('submit', () => {
    form.elements.namedItem('elapsed').value = String(Date.now() - opened);
  });
}
