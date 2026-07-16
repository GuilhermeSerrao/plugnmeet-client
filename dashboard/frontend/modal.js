export function openModal(innerHtml) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

export function closeModal(backdrop) {
  backdrop.remove();
}
