function applyInitialURLFilters() {
  const url = new URL(window.location.href);
  const pClient   = url.searchParams.getAll('client');
  const pProject  = url.searchParams.getAll('project');
  const pOwner    = url.searchParams.getAll('owner');
  const pPlatform = url.searchParams.getAll('platform');
  const pStatus   = url.searchParams.getAll('status');

  // guardar locks (lo que llega en URL se considera fijado)
  state.locked.clients  = [...pClient];
  state.locked.projects = [...pProject];

  // set inicial seleccionado
  state.selected.clients   = [...pClient];
  state.selected.projects  = [...pProject];
  state.selected.owners    = [...pOwner];
  state.selected.platforms = [...pPlatform];
  state.selected.statuses  = [...pStatus];

  updateButtonsText();

  // si hay client, filtra menú de Projects acorde
  if (pClient.length) filterProjectsForClients();

  // ======= LOCK VISUAL (deshabilita selects si vienen fijados) =======
  try {
    if (state.locked.clients.length && els.fClient) {
      els.fClient.classList.add('is-locked');
      els.fClient.setAttribute('disabled', 'true');
      els.fClient.title = 'Locked from portal';
    }
    if (state.locked.projects.length && els.fProject) {
      els.fProject.classList.add('is-locked');
      els.fProject.setAttribute('disabled', 'true');
      els.fProject.title = 'Locked from portal';
    }
    // cerrar menús si estaban abiertos
    closeAllSelects();
  } catch {}
}
