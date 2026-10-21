/* LINGUA/OS · Apple-style scroll reveal (IntersectionObserver, 0 deps) */
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
    return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('active');
      obs.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  const seen = new WeakSet();
  const scan = (scope = document) => {
    scope.querySelectorAll('.reveal:not(.active)').forEach((el, i) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.style.setProperty('--reveal-i', i % 6); // лёгкий каскад
      io.observe(el);
    });
  };
  scan();
  // SPA: подхватываем элементы, которые рендерятся после навигации
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
})();
