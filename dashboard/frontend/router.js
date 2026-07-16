const views = new Map(); // name -> { title, render(container) }
let currentView = null;

export function registerView(name, config) {
  views.set(name, config);
}

export async function navigate(name) {
  if (!views.has(name)) name = [...views.keys()][0];
  currentView = name;

  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === name);
  });

  const view = views.get(name);
  document.getElementById('viewTitle').textContent = view.title;

  const container = document.getElementById('viewContainer');
  container.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    await view.render(container);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Failed to load: ${err.message}</p>`;
  }

  location.hash = name;
}

export function refreshCurrentView() {
  if (currentView) navigate(currentView);
}

export function startRouter() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });

  const initial = location.hash.replace('#', '') || [...views.keys()][0];
  navigate(initial);
}
