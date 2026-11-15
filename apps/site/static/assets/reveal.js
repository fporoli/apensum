// "Show phone number": the number is in the page only reversed and base64-encoded
// (data-v, see phoneReveal in src/pages.mjs), so crawlers and address scrapers reading the HTML
// don't find it. A click turns the button into a normal tel: link.
document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-v]') : null;
  if (!button) return;
  const number = [...atob(button.dataset.v)].reverse().join('');
  const link = document.createElement('a');
  link.href = `tel:${number.replace(/[^+\d]/g, '')}`;
  link.textContent = number;
  link.className = 'phone';
  button.replaceWith(link);
  link.focus();
});
