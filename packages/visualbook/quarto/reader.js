/* Adaptation only: no scroll-driven animation and no replacement navigation. */
(() => {
  const frames = [...document.querySelectorAll('iframe.visualbook-widget')];
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'visualbook-widget-size') return;
    const frame = frames.find(frame => frame.id === event.data.id);
    if (frame && event.source === frame.contentWindow &&
        Number.isFinite(event.data.height) && event.data.height > 0 && event.data.height < 5000)
      frame.style.height = `${Math.ceil(event.data.height)}px`;
  });
  const pause = () => frames.forEach(frame => {
    if (frame.contentWindow) frame.contentWindow.postMessage({type: 'visualbook-reader-pause'}, location.origin);
  });
  addEventListener('scroll', pause, {passive: true});
  addEventListener('wheel', pause, {passive: true});
  addEventListener('touchmove', pause, {passive: true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  const equations = () => [...document.querySelectorAll('main mjx-container[jax="SVG"]')];
  function refreshEquations() {
    for (const equation of equations()) {
      const svg = equation.querySelector(':scope > svg');
      if (!svg) continue;
      if (!equation.hasAttribute('display')) {
        const flow = equation.closest('p,li,td,th,h1,h2,h3,h4,figcaption') ?? equation.parentElement.parentElement;
        const width = flow.getBoundingClientRect().width;
        equation.toggleAttribute('data-vh-long-inline', svg.getBoundingClientRect().width > width + 2);
      }
      const wide = equation.scrollWidth > equation.clientWidth + 2;
      if (wide) {
        equation.setAttribute('tabindex', '0');
        equation.setAttribute('role', 'region');
        equation.setAttribute('aria-label', '长公式，可用左右方向键横向查看');
      } else {
        equation.removeAttribute('tabindex');
        equation.removeAttribute('role');
        equation.removeAttribute('aria-label');
      }
    }
  }
  document.addEventListener('keydown', event => {
    const equation = event.target.closest?.('mjx-container[role="region"]');
    if (!equation || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') equation.scrollLeft -= 48;
    else if (event.key === 'ArrowRight') equation.scrollLeft += 48;
    else if (event.key === 'Home') equation.scrollLeft = 0;
    else if (event.key === 'End') equation.scrollLeft = equation.scrollWidth;
    else return;
    event.preventDefault();
  });
  addEventListener('resize', refreshEquations, {passive: true});
  addEventListener('load', async () => {
    await window.MathJax?.startup?.promise;
    refreshEquations();
    document.documentElement.dataset.visualbookReaderReady = 'true';
  });
})();
