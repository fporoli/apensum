// Enlarges a screenshot (.shot a) or a news post's picture in a dialog over the page instead of opening
// the file: Esc, the close button or a click beside the picture closes it. Without this script the
// screenshot's link still opens the picture itself. The close button's label is the script's data-close.
(() => {
  const label = document.currentScript?.dataset.close || 'Close';
  let dialog = null;
  function open(src, alt) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'zoom';
      dialog.innerHTML = '<button type="button" class="zoom-close" aria-label=""><span aria-hidden="true">×</span></button><img alt="">';
      dialog.querySelector('.zoom-close').setAttribute('aria-label', label);
      dialog.querySelector('.zoom-close').addEventListener('click', () => dialog.close());
      // A click on the dimmed area (the dialog itself, not the picture or the button) closes it.
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => { document.documentElement.classList.remove('zoom-open'); });
      document.body.appendChild(dialog);
    }
    const img = dialog.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    document.documentElement.classList.add('zoom-open');
    dialog.showModal(); // Esc closes a modal dialog by itself
  }
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof HTMLDialogElement !== 'function') return;
    const link = e.target.closest?.('.shot a');
    if (link) {
      e.preventDefault();
      open(link.href, link.querySelector('img')?.alt);
      return;
    }
    const pic = e.target.closest?.('.news-posts img');
    if (pic) open(pic.currentSrc || pic.src, pic.alt);
  });
})();
