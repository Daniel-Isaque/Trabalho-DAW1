/* =========================================================
   IFEventos - Controlador de Interface, Autenticação e CRUD
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const ACADEMIC_DOMAIN = '@academico.ifpb.edu.br';

  let events = [];
  let currentUser = ApiClient.getUser();
  let onlySubscribed = false;
  let pendingDeleteId = null;
  let activeDetailEventId = null;

  // Telas principais
  const loginScreen = document.getElementById('login-screen');
  const appShell = document.getElementById('app-shell');

  // Visões da Tela de Autenticação
  const viewLoginAluno = document.getElementById('view-login-aluno');
  const viewRegisterAluno = document.getElementById('view-register-aluno');
  const viewLoginAdmin = document.getElementById('view-login-admin');

  const formLoginAluno = document.getElementById('form-login-aluno');
  const formRegisterAluno = document.getElementById('form-register-aluno');
  const formLoginAdmin = document.getElementById('form-login-admin');

  // Elementos do Portal
  const eventsGrid = document.getElementById('events-grid');
  const searchInput = document.getElementById('search-input');
  const filterCategory = document.getElementById('filter-category');
  const filterDate = document.getElementById('filter-date');
  const btnClearTop = document.getElementById('btn-clear-top');
  const statCardInscritos = document.getElementById('stat-card-inscritos');
  const eventForm = document.getElementById('event-form');
  const confirmDialog = document.getElementById('confirm-dialog');
  const detailDialog = document.getElementById('event-detail-dialog');
  const accountDialog = document.getElementById('account-dialog');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabBtnRegister = document.getElementById('tab-btn-register');

  // --- MODO ESCURO (DARK MODE) ---
  function syncThemeUI() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const labelText = isDark ? 'Modo Claro' : 'Modo Escuro';
    const ariaText = isDark ? 'Ativar modo claro' : 'Ativar modo escuro';

    ['theme-toggle', 'login-theme-toggle'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.setAttribute('aria-pressed', String(isDark));
        btn.setAttribute('aria-label', ariaText);
      }
    });

    ['theme-label', 'login-theme-label'].forEach(lblId => {
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = labelText;
    });
  }

  function toggleTheme() {
    const isCurrentlyDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isCurrentlyDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('ifeventos_theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ifeventos_theme', 'dark');
    }
    syncThemeUI();
  }

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('login-theme-toggle').addEventListener('click', toggleTheme);
  syncThemeUI();

  // --- UTILITÁRIOS ---
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3400);
  }

  function setFieldError(fieldId, message) {
    const input = document.getElementById(fieldId);
    const errorEl = document.getElementById(`error-${fieldId}`);
    if (!input || !errorEl) return;

    if (message) {
      input.classList.add('input-error');
      errorEl.textContent = message;
      errorEl.classList.add('visible');
    } else {
      input.classList.remove('input-error');
      errorEl.textContent = '';
      errorEl.classList.remove('visible');
    }
  }

  function handleLogout(msg = 'Sessão encerrada.') {
    ApiClient.clearSession();
    currentUser = null;
    events = [];
    resetAllFilters();
    switchAuthView('login-aluno');
    appShell.hidden = true;
    loginScreen.hidden = false;
    if (msg) showToast(msg, 'warning');
  }

  // --- NAVEGAÇÃO ENTRE TELAS DE AUTENTICAÇÃO (LOGIN / CRIAR CONTA / ADMIN) ---
  function switchAuthView(targetView) {
    viewLoginAluno.hidden = targetView !== 'login-aluno';
    viewRegisterAluno.hidden = targetView !== 'register-aluno';
    viewLoginAdmin.hidden = targetView !== 'login-admin';

    [
      'login-email', 'login-password',
      'reg-name', 'reg-email', 'reg-password', 'reg-password-confirm',
      'admin-password'
    ].forEach(id => setFieldError(id, ''));

    if (targetView === 'login-aluno') {
      document.getElementById('login-email').focus();
    } else if (targetView === 'register-aluno') {
      document.getElementById('reg-name').focus();
    } else if (targetView === 'login-admin') {
      document.getElementById('admin-password').focus();
    }
  }

  document.querySelectorAll('[data-auth-view]').forEach(btn => {
    btn.addEventListener('click', () => switchAuthView(btn.dataset.authView));
  });

  // Mostrar / Ocultar senha (ícone de olho)
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetInput = document.getElementById(btn.dataset.togglePassword);
      if (!targetInput) return;
      const isPassword = targetInput.type === 'password';
      targetInput.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  // Limpa erros inline ao digitar
  [
    'login-email', 'login-password',
    'reg-name', 'reg-email', 'reg-password', 'reg-password-confirm',
    'admin-password',
    'current-password', 'new-password', 'confirm-new-password'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => setFieldError(id, ''));
  });

  // 1. LOGIN DO ALUNO (E-mail + Senha no SQLite)
  formLoginAluno.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError('login-email', '');
    setFieldError('login-password', '');

    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const senha = document.getElementById('login-password').value;

    if (!email || !email.endsWith(ACADEMIC_DOMAIN)) {
      setFieldError('login-email', 'Informe seu e-mail institucional @academico.ifpb.edu.br.');
      document.getElementById('login-email').focus();
      return;
    }

    if (!senha) {
      setFieldError('login-password', 'Informe sua senha.');
      document.getElementById('login-password').focus();
      return;
    }

    try {
      const data = await ApiClient.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha })
      });

      ApiClient.setSession(data.token, data.user);
      currentUser = data.user;
      formLoginAluno.reset();
      await enterApplication();
      showToast(`Bem-vindo(a) de volta, ${currentUser.nome}!`);
    } catch (err) {
      setFieldError('login-password', err.message);
    }
  });

  // 2. CREATE: CADASTRO ÚNICO DE ALUNO + CRIAÇÃO DE SENHA
  formRegisterAluno.addEventListener('submit', async (e) => {
    e.preventDefault();
    ['reg-name', 'reg-email', 'reg-password', 'reg-password-confirm'].forEach(id => setFieldError(id, ''));

    const nome = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const senha = document.getElementById('reg-password').value;
    const confirmarSenha = document.getElementById('reg-password-confirm').value;

    const regexNome = /[a-zA-ZÀ-ÿ]{3,}/;
    const regexEmailAcademico = /^[a-zA-Z0-9._-]+@academico\.ifpb\.edu\.br$/i;

    let firstInvalid = null;

    if (!nome || !regexNome.test(nome)) {
      setFieldError('reg-name', 'Informe seu Nome ou Nome Social (mínimo 3 letras).');
      firstInvalid = firstInvalid || 'reg-name';
    }

    if (!email || !email.endsWith(ACADEMIC_DOMAIN) || !regexEmailAcademico.test(email)) {
      setFieldError('reg-email', 'Obrigatório utilizar e-mail terminado em @academico.ifpb.edu.br.');
      firstInvalid = firstInvalid || 'reg-email';
    }

    if (senha.length < 6) {
      setFieldError('reg-password', 'Crie uma senha com pelo menos 6 caracteres.');
      firstInvalid = firstInvalid || 'reg-password';
    }

    if (senha !== confirmarSenha) {
      setFieldError('reg-password-confirm', 'As senhas digitadas não coincidem.');
      firstInvalid = firstInvalid || 'reg-password-confirm';
    }

    if (firstInvalid) {
      document.getElementById(firstInvalid).focus();
      return;
    }

    try {
      const data = await ApiClient.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ nome, email, senha })
      });

      ApiClient.setSession(data.token, data.user);
      currentUser = data.user;
      formRegisterAluno.reset();
      await enterApplication();
      showToast(`Cadastro único criado com sucesso! Bem-vindo(a), ${currentUser.nome}.`);
    } catch (err) {
      if (err.status === 409) {
        setFieldError('reg-email', err.message);
        document.getElementById('reg-email').focus();
      } else {
        setFieldError('reg-password-confirm', err.message);
      }
    }
  });

  // 3. LOGIN DO ADMINISTRADOR
  formLoginAdmin.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError('admin-password', '');

    const senha = document.getElementById('admin-password').value;
    if (!senha) {
      setFieldError('admin-password', 'Digite a senha de administrador.');
      return;
    }

    try {
      const data = await ApiClient.request('/api/auth/login-admin', {
        method: 'POST',
        body: JSON.stringify({ senha })
      });

      ApiClient.setSession(data.token, data.user);
      currentUser = data.user;
      formLoginAdmin.reset();
      await enterApplication();
      showToast('Acesso de Administrador liberado!');
    } catch (err) {
      setFieldError('admin-password', err.message);
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => handleLogout());

  // --- ENTRADA NA APLICAÇÃO E CARREGAMENTO DO SQLITE ---
  async function enterApplication() {
    if (!currentUser || !ApiClient.getToken()) {
      loginScreen.hidden = false;
      appShell.hidden = true;
      return;
    }

    try {
      const meData = await ApiClient.request('/api/auth/me');
      currentUser = meData.user;
      ApiClient.setSession(ApiClient.getToken(), currentUser);

      loginScreen.hidden = true;
      appShell.hidden = false;

      document.getElementById('header-user-name').textContent = currentUser.nome;
      document.getElementById('header-user-role').textContent =
        currentUser.perfil === 'admin' ? 'Admin' : 'Aluno';

      const isAdmin = currentUser.perfil === 'admin';
      tabBtnRegister.hidden = !isAdmin;

      switchTab('events');
      updateMinDateTime();
      await fetchAndRenderEvents();
    } catch (err) {
      handleLogout('Sua sessão expirou. Faça login novamente.');
    }
  }

  async function fetchAndRenderEvents() {
    try {
      const data = await ApiClient.request('/api/eventos');
      events = data.eventos || [];
      renderEvents();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        handleLogout('Sessão inválida. Entre novamente.');
      } else {
        showToast(err.message, 'warning');
      }
    }
  }

  // --- CRUD DE CONTA E SENHA (MODAL MINHA CONTA) ---
  document.getElementById('open-account-btn').addEventListener('click', async () => {
    if (!currentUser) return;

    document.getElementById('acc-name').textContent = currentUser.nome;
    document.getElementById('acc-email').textContent = currentUser.email;
    document.getElementById('acc-role').textContent =
      currentUser.perfil === 'admin' ? 'Administrador do Câmpus' : 'Estudante IFPB';

    document.getElementById('form-change-password').reset();
    ['current-password', 'new-password', 'confirm-new-password'].forEach(id => setFieldError(id, ''));

    const isAdmin = currentUser.perfil === 'admin';
    document.getElementById('student-delete-zone').hidden = isAdmin;
    document.getElementById('admin-users-zone').hidden = !isAdmin;

    if (isAdmin) {
      await loadAdminUsersList();
    }

    accountDialog.showModal();
  });

  document.getElementById('account-close-x').addEventListener('click', () => accountDialog.close());

  document.getElementById('form-change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    ['current-password', 'new-password', 'confirm-new-password'].forEach(id => setFieldError(id, ''));

    const senhaAtual = document.getElementById('current-password').value;
    const novaSenha = document.getElementById('new-password').value;
    const confirmarNova = document.getElementById('confirm-new-password').value;

    const minLen = currentUser?.perfil === 'admin' ? 4 : 6;
    let hasErr = false;

    if (!senhaAtual) {
      setFieldError('current-password', 'Informe sua senha atual.');
      hasErr = true;
    }

    if (novaSenha.length < minLen) {
      setFieldError('new-password', `A nova senha deve ter pelo menos ${minLen} caracteres.`);
      hasErr = true;
    }

    if (novaSenha !== confirmarNova) {
      setFieldError('confirm-new-password', 'A confirmação da nova senha não coincide.');
      hasErr = true;
    }

    if (hasErr) return;

    try {
      const data = await ApiClient.request('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ senhaAtual, novaSenha })
      });

      document.getElementById('form-change-password').reset();
      accountDialog.close();
      showToast(data.message);
    } catch (err) {
      setFieldError('current-password', err.message);
    }
  });

  document.getElementById('btn-delete-own-account').addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Tem certeza que deseja excluir permanentemente sua conta e liberar suas vagas nos eventos?'
    );
    if (!confirmed) return;

    try {
      await ApiClient.request('/api/auth/me', { method: 'DELETE' });
      accountDialog.close();
      handleLogout('Sua conta foi excluída do sistema.');
    } catch (err) {
      showToast(err.message, 'warning');
    }
  });

  async function loadAdminUsersList() {
    const listContainer = document.getElementById('admin-users-list');
    listContainer.innerHTML = '<p class="field-hint">Carregando alunos cadastrados...</p>';

    try {
      const data = await ApiClient.request('/api/usuarios');
      const usuarios = data.usuarios || [];

      if (usuarios.length === 0) {
        listContainer.innerHTML = '<p class="field-hint">Nenhum aluno cadastrado até o momento.</p>';
        return;
      }

      listContainer.innerHTML = usuarios.map(u => `
        <div class="admin-user-item">
          <div class="admin-user-meta">
            <strong>${escapeHTML(u.nome)}</strong>
            <span>${escapeHTML(u.email)} • ${u.total_inscricoes} inscrição(ões)</span>
          </div>
          <div class="admin-user-actions">
            <button type="button" class="btn-mini btn-mini-reset" data-admin-user-action="reset-pass" data-user-id="${u.id}" data-user-name="${escapeHTML(u.nome)}">
              Nova Senha
            </button>
            <button type="button" class="btn-mini btn-mini-del" data-admin-user-action="del-user" data-user-id="${u.id}" data-user-name="${escapeHTML(u.nome)}">
              Excluir
            </button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      listContainer.innerHTML = `<p class="error-msg visible">${escapeHTML(err.message)}</p>`;
    }
  }

  document.getElementById('admin-users-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-admin-user-action]');
    if (!btn) return;

    const action = btn.dataset.adminUserAction;
    const userId = Number(btn.dataset.userId);
    const userName = btn.dataset.userName;

    if (action === 'reset-pass') {
      const novaSenha = window.prompt(`Digite a nova senha (mínimo 6 caracteres) para ${userName}:`);
      if (!novaSenha) return;

      try {
        const res = await ApiClient.request(`/api/usuarios/${userId}/password`, {
          method: 'PUT',
          body: JSON.stringify({ novaSenha })
        });
        showToast(res.message);
      } catch (err) {
        showToast(err.message, 'warning');
      }
    } else if (action === 'del-user') {
      const ok = window.confirm(`Remover o cadastro do aluno "${userName}" e liberar suas vagas?`);
      if (!ok) return;

      try {
        const res = await ApiClient.request(`/api/usuarios/${userId}`, { method: 'DELETE' });
        showToast(res.message, 'warning');
        await loadAdminUsersList();
        await fetchAndRenderEvents();
      } catch (err) {
        showToast(err.message, 'warning');
      }
    }
  });

  // --- NAVEGAÇÃO, FILTROS E VITRINE ---
  function updateMinDateTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('datetime').min = now.toISOString().slice(0, 16);
  }

  function switchTab(tabName) {
    if (tabName === 'register' && currentUser?.perfil !== 'admin') return;

    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    tabButtons.forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', String(isTarget));
    });

    if (tabName === 'events') {
      document.getElementById('tab-events').classList.add('active');
    } else if (tabName === 'register') {
      updateMinDateTime();
      document.getElementById('tab-register').classList.add('active');
    }
  }

  function matchesDatePeriod(datetimeStr, period) {
    if (period === 'todos') return true;
    const evtDate = new Date(datetimeStr);
    if (isNaN(evtDate.getTime())) return true;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'hoje') {
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return evtDate >= startOfToday && evtDate < endOfToday;
    }
    if (period === 'semana') {
      const sevenDaysLater = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
      return evtDate >= startOfToday && evtDate <= sevenDaysLater;
    }
    if (period === 'mes') {
      const thirtyDaysLater = new Date(startOfToday.getTime() + 30 * 24 * 60 * 60 * 1000);
      return evtDate >= startOfToday && evtDate <= thirtyDaysLater;
    }
    return true;
  }

  function resetAllFilters() {
    searchInput.value = '';
    filterCategory.value = 'todos';
    filterDate.value = 'todos';
    onlySubscribed = false;
    statCardInscritos.classList.remove('active-filter');
    statCardInscritos.setAttribute('aria-pressed', 'false');
    document.getElementById('stat-inscritos-hint').textContent = 'Filtrar';
    if (currentUser) renderEvents();
  }

  function updateStats() {
    document.getElementById('stat-total').textContent = events.length;

    const totalVagas = events.reduce((acc, evt) => acc + Number(evt.vagas), 0);
    document.getElementById('stat-vagas').textContent = totalVagas;

    const totalInscritos = events.filter(evt => evt.subscribed).length;
    document.getElementById('stat-inscritos').textContent = totalInscritos;
  }

  function renderEvents() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const selectedCategory = filterCategory.value;
    const selectedDate = filterDate.value;
    const isAdmin = currentUser?.perfil === 'admin';

    const hasActiveFilters = searchTerm !== '' || selectedCategory !== 'todos' || selectedDate !== 'todos' || onlySubscribed;
    btnClearTop.hidden = !hasActiveFilters;

    eventsGrid.innerHTML = '';

    const filteredEvents = events
      .filter(evt => {
        const matchesSearch = evt.title.toLowerCase().includes(searchTerm) || evt.speaker.toLowerCase().includes(searchTerm);
        const matchesCategory = selectedCategory === 'todos' || evt.category === selectedCategory;
        const matchesDate = matchesDatePeriod(evt.datetime, selectedDate);
        const matchesSub = !onlySubscribed || evt.subscribed;
        return matchesSearch && matchesCategory && matchesDate && matchesSub;
      })
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    document.getElementById('results-summary').textContent =
      `${filteredEvents.length} evento(s) exibido(s) em ordem cronológica • Clique em um evento para confirmar presença`;

    if (filteredEvents.length === 0) {
      eventsGrid.innerHTML = `
        <div class="empty-state">
          <p>Nenhum evento acadêmico encontrado com os critérios selecionados.</p>
          ${hasActiveFilters ? '<button type="button" class="btn-reset-filters" data-action="reset-filters">Limpar filtros</button>' : ''}
        </div>
      `;
      updateStats();
      return;
    }

    filteredEvents.forEach(evt => {
      const card = document.createElement('article');
      card.className = `event-card ${evt.subscribed ? 'is-subscribed' : ''}`;
      card.dataset.eventId = evt.id;
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');

      const formattedDate = new Date(evt.datetime).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      const totalVagas = evt.vagasTotais;
      const ocupadas = Math.max(0, totalVagas - evt.vagas);
      const pctOcupado = totalVagas > 0 ? Math.min(100, Math.round((ocupadas / totalVagas) * 100)) : 100;
      const barClass = evt.vagas === 0 ? 'full' : (pctOcupado >= 75 ? 'warning' : '');

      card.innerHTML = `
        <div>
          <div class="card-badges">
            <span class="badge-category badge-${escapeHTML(evt.category)}">${escapeHTML(evt.category)}</span>
            ${evt.subscribed ? '<span class="badge-subscribed">Inscrito</span>' : ''}
          </div>
          <h3>${escapeHTML(evt.title)}</h3>
          <div class="event-details">
            <p><strong>Ministrante:</strong> ${escapeHTML(evt.speaker)}</p>
            <p><strong>Data/Hora:</strong> ${formattedDate}</p>
            <p><strong>Local:</strong> ${escapeHTML(evt.location)}</p>
          </div>
        </div>
        <div class="event-footer">
          <div class="capacity-wrapper">
            <div class="capacity-header">
              <span class="seats-count ${evt.vagas <= 5 ? 'low' : ''}">
                ${evt.vagas === 0 ? 'Vagas esgotadas' : `${evt.vagas} de ${totalVagas} vaga(s) livre(s)`}
              </span>
              <span class="capacity-percent">${pctOcupado}% ocupado</span>
            </div>
            <div class="progress-track" role="progressbar" aria-valuenow="${pctOcupado}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-fill ${barClass}" style="width: ${pctOcupado}%"></div>
            </div>
          </div>
          <div class="card-actions">
            <button type="button"
                    class="${evt.subscribed ? 'btn-unsubscribe' : 'btn-subscribe'}"
                    data-action="open-detail"
                    data-id="${evt.id}"
                    ${!evt.subscribed && evt.vagas === 0 ? 'disabled' : ''}>
              ${evt.subscribed ? 'Cancelar inscrição' : (evt.vagas === 0 ? 'Esgotado' : 'Garantir Vaga')}
            </button>
            ${isAdmin ? `<button type="button" class="btn-delete" data-action="request-delete" data-id="${evt.id}">Excluir</button>` : ''}
          </div>
        </div>
      `;

      eventsGrid.appendChild(card);
    });

    updateStats();
  }

  // --- MODAL DE DETALHES E INSCRIÇÃO ---
  function openEventDetailModal(id) {
    const evt = events.find(item => item.id === id);
    if (!evt) return;

    activeDetailEventId = id;

    document.getElementById('detail-badges').innerHTML = `
      <span class="badge-category badge-${escapeHTML(evt.category)}">${escapeHTML(evt.category)}</span>
      ${evt.subscribed ? '<span class="badge-subscribed">Inscrição Confirmada</span>' : ''}
    `;

    document.getElementById('detail-title').textContent = evt.title;
    document.getElementById('detail-description').textContent =
      evt.description || 'Atividade acadêmica institucional promovida pelo Câmpus IFPB.';
    document.getElementById('detail-speaker').textContent = evt.speaker;
    document.getElementById('detail-datetime').textContent = new Date(evt.datetime).toLocaleString('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'short'
    });
    document.getElementById('detail-location').textContent = evt.location;

    const totalVagas = evt.vagasTotais;
    const ocupadas = Math.max(0, totalVagas - evt.vagas);
    const pctOcupado = totalVagas > 0 ? Math.min(100, Math.round((ocupadas / totalVagas) * 100)) : 100;
    const barClass = evt.vagas === 0 ? 'full' : (pctOcupado >= 75 ? 'warning' : '');

    document.getElementById('detail-capacity').innerHTML = `
      <div class="capacity-wrapper">
        <div class="capacity-header">
          <span class="seats-count ${evt.vagas <= 5 ? 'low' : ''}">
            ${evt.vagas === 0 ? 'Vagas esgotadas' : `${evt.vagas} de ${totalVagas} vaga(s) livre(s)`}
          </span>
          <span class="capacity-percent">${pctOcupado}% ocupado</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${barClass}" style="width: ${pctOcupado}%"></div>
        </div>
      </div>
    `;

    const promptBox = document.getElementById('detail-prompt-box');
    const actionBtn = document.getElementById('detail-action-btn');

    if (evt.subscribed) {
      promptBox.className = 'detail-prompt-box subscribed-state';
      promptBox.textContent = `Você (${currentUser.nome}) já está inscrito neste evento. Deseja cancelar sua inscrição e liberar sua vaga?`;
      actionBtn.className = 'btn-dialog-primary cancel-mode';
      actionBtn.textContent = 'Cancelar Inscrição';
      actionBtn.disabled = false;
    } else if (evt.vagas === 0) {
      promptBox.className = 'detail-prompt-box subscribed-state';
      promptBox.textContent = 'Este evento atingiu o limite máximo de participantes.';
      actionBtn.className = 'btn-dialog-primary';
      actionBtn.textContent = 'Vagas Esgotadas';
      actionBtn.disabled = true;
    } else {
      promptBox.className = 'detail-prompt-box';
      promptBox.textContent = `Deseja confirmar sua presença como ${currentUser.nome} e reservar uma vaga neste evento?`;
      actionBtn.className = 'btn-dialog-primary';
      actionBtn.textContent = 'Confirmar Presença';
      actionBtn.disabled = false;
    }

    detailDialog.showModal();
  }

  function closeEventDetailModal() {
    activeDetailEventId = null;
    detailDialog.close();
  }

  async function toggleSubscription(id) {
    try {
      const data = await ApiClient.request(`/api/eventos/${id}/inscricao`, {
        method: 'POST'
      });
      await fetchAndRenderEvents();
      showToast(data.message, data.subscribed ? 'success' : 'warning');
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  function requestDeleteEvent(id) {
    if (currentUser?.perfil !== 'admin') return;
    const target = events.find(evt => evt.id === id);
    if (!target) return;
    pendingDeleteId = id;
    document.getElementById('dialog-message').textContent =
      `Tem certeza que deseja excluir o evento "${target.title}" do banco de dados?`;
    confirmDialog.showModal();
  }

  // --- LISTENERS DE EVENTOS ---
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  eventsGrid.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-action="request-delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      requestDeleteEvent(Number(deleteBtn.dataset.id));
      return;
    }

    const resetBtn = e.target.closest('[data-action="reset-filters"]');
    if (resetBtn) {
      resetAllFilters();
      return;
    }

    const card = e.target.closest('.event-card');
    if (card) {
      openEventDetailModal(Number(card.dataset.eventId));
    }
  });

  eventsGrid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.event-card');
      if (card && !e.target.closest('button')) {
        e.preventDefault();
        openEventDetailModal(Number(card.dataset.eventId));
      }
    }
  });

  document.getElementById('detail-action-btn').addEventListener('click', async () => {
    if (activeDetailEventId !== null) {
      const targetId = activeDetailEventId;
      closeEventDetailModal();
      await toggleSubscription(targetId);
    }
  });

  document.getElementById('detail-cancel-btn').addEventListener('click', closeEventDetailModal);
  document.getElementById('detail-close-x').addEventListener('click', closeEventDetailModal);

  [detailDialog, confirmDialog, accountDialog].forEach(dlg => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  });

  document.getElementById('dialog-cancel').addEventListener('click', () => {
    pendingDeleteId = null;
    confirmDialog.close();
  });

  document.getElementById('dialog-confirm').addEventListener('click', async () => {
    if (pendingDeleteId !== null && currentUser?.perfil === 'admin') {
      try {
        const res = await ApiClient.request(`/api/eventos/${pendingDeleteId}`, {
          method: 'DELETE'
        });
        pendingDeleteId = null;
        confirmDialog.close();
        await fetchAndRenderEvents();
        showToast(res.message, 'warning');
      } catch (err) {
        confirmDialog.close();
        showToast(err.message, 'warning');
      }
    }
  });

  function toggleMySubscriptionsFilter() {
    onlySubscribed = !onlySubscribed;
    statCardInscritos.classList.toggle('active-filter', onlySubscribed);
    statCardInscritos.setAttribute('aria-pressed', String(onlySubscribed));
    document.getElementById('stat-inscritos-hint').textContent = onlySubscribed ? 'Ativo (ver todos)' : 'Filtrar';
    renderEvents();
  }

  statCardInscritos.addEventListener('click', toggleMySubscriptionsFilter);
  statCardInscritos.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMySubscriptionsFilter();
    }
  });

  searchInput.addEventListener('input', renderEvents);
  filterCategory.addEventListener('change', renderEvents);
  filterDate.addEventListener('change', renderEvents);
  btnClearTop.addEventListener('click', resetAllFilters);

  function clearFormErrors() {
    ['title', 'speaker', 'category', 'datetime', 'location', 'vagas'].forEach(id => setFieldError(id, ''));
  }

  ['title', 'speaker', 'datetime', 'location', 'vagas'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => setFieldError(id, ''));
  });

  eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (currentUser?.perfil !== 'admin') return;
    clearFormErrors();

    const title = document.getElementById('title').value.trim();
    const speaker = document.getElementById('speaker').value.trim();
    const datetime = document.getElementById('datetime').value;
    const location = document.getElementById('location').value.trim();
    const category = document.getElementById('category').value;
    const vagasVal = document.getElementById('vagas').value;
    const vagasTotais = parseInt(vagasVal, 10);
    const description = document.getElementById('description').value.trim();

    const regexPalavraValida = /[a-zA-ZÀ-ÿ0-9]{3,}/;
    let firstInvalidField = null;

    if (!title || !regexPalavraValida.test(title)) {
      setFieldError('title', 'Informe um título válido com pelo menos 3 caracteres.');
      firstInvalidField = firstInvalidField || 'title';
    }

    if (!speaker || !regexPalavraValida.test(speaker)) {
      setFieldError('speaker', 'Informe o nome do ministrante com pelo menos 3 caracteres.');
      firstInvalidField = firstInvalidField || 'speaker';
    }

    if (!datetime) {
      setFieldError('datetime', 'Selecione a data e o horário do evento.');
      firstInvalidField = firstInvalidField || 'datetime';
    }

    if (!location || !regexPalavraValida.test(location)) {
      setFieldError('location', 'Informe o local do evento com pelo menos 3 caracteres.');
      firstInvalidField = firstInvalidField || 'location';
    }

    if (!vagasVal || isNaN(vagasTotais) || vagasTotais < 1 || vagasTotais > 500) {
      setFieldError('vagas', 'Informe uma quantidade de vagas entre 1 e 500.');
      firstInvalidField = firstInvalidField || 'vagas';
    }

    if (firstInvalidField) {
      document.getElementById(firstInvalidField).focus();
      return;
    }

    try {
      const res = await ApiClient.request('/api/eventos', {
        method: 'POST',
        body: JSON.stringify({
          title,
          speaker,
          datetime,
          location,
          category,
          vagasTotais,
          description
        })
      });

      eventForm.reset();
      switchTab('events');
      await fetchAndRenderEvents();
      showToast(res.message);
    } catch (err) {
      showToast(err.message, 'warning');
    }
  });

  // Inicialização
  enterApplication();
});