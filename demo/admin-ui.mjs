// Shared, bounded pagination for client-side administration lists.
// Cursor-based audit pagination stays server-driven in app.js.
export function paginate(host, rows, size, render, label, initialPage = 0, onPage = () => {}) {
  let page = initialPage;
  host.innerHTML =
    '<div class="page-content"></div><nav class="admin-pagination" aria-label="Seitennavigation"><button type="button" data-page="previous">Zurück</button><span role="status"></span><button type="button" data-page="next">Weiter</button></nav>';
  const content = host.querySelector('.page-content');
  const paint = () => {
    const count = Math.max(1, Math.ceil(rows.length / size));
    page = Math.max(0, Math.min(page, count - 1));
    content.replaceChildren();
    const html = render(rows.slice(page * size, (page + 1) * size), content);
    if (typeof html === 'string') content.innerHTML = html;
    host.querySelector('[role="status"]').textContent =
      `Seite ${page + 1} von ${count} · ${rows.length} ${label}`;
    host.querySelector('[data-page="previous"]').disabled = page === 0;
    host.querySelector('[data-page="next"]').disabled = page + 1 === count;
    onPage(page);
  };
  host.querySelector('[data-page="previous"]').onclick = () => {
    page--;
    paint();
  };
  host.querySelector('[data-page="next"]').onclick = () => {
    page++;
    paint();
  };
  paint();
}
