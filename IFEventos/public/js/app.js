/* =========================================================
   IFEventos - Controlador de Interface
   Perfis: aluno, professor e admin (conta única com subtipos)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const STATUS_LABEL = {
    rascunho: 'Rascunho', pendente: 'Aguardando aprovação', aprovado: 'Aprovado',
    rejeitado: 'Rejeitado', cancelado: 'Cancelado', encerrado: 'Encerrado'
  };
  const STATUS_ORDER = ['pendente', 'rascunho', 'rejeitado', 'aprovado', 'encerrado', 'cancelado'];
  const TIPO_USUARIO_LABEL = { aluno: 'Aluno', professor: 'Professor', admin: 'Admin' };
  const NIVEL_LABEL = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };
  const REGEX_PALAVRA = /[a-zA-ZÀ-ÿ0-9]{3,}/;

  let events = [];            // catálogo
  let manageEvents = [];      // eventos gerenciáveis (professor/admin)
  let locais = [];
  let professores = [];
  let lookupsLoaded = false;
  let currentUser = ApiClient.getUser();
  let onlySubscribed = false;
  let activeDetailEventId = null;
  let editingEventId = null;
  let rejectTargetId = null;
  let attendeesEventId = null;
  let currentTab = 'events';

  const loginScreen = $('login-screen');
  const appShell = $('app-shell');
  const viewLoginAluno = $('view-login-aluno');
  const viewRegisterAluno = $('view-register-aluno');
  const formLoginAluno = $('form-login-aluno');
  const formRegisterAluno = $('form-register-aluno');
  const eventsGrid = $('events-grid');
  const searchInput = $('search-input');
  const filterCategory = $('filter-category');
  const filterDate = $('filter-date');
  const btnClearTop = $('btn-clear-top');
  const statCardInscritos = $('stat-card-inscritos');
  const eventForm = $('event-form');
  const confirmDialog = $('confirm-dialog');
  const detailDialog = $('event-detail-dialog');
  const accountDialog = $('account-dialog');
  const attendeesDialog = $('attendees-dialog');
  const rejectDialog = $('reject-dialog');
  const certificateDialog = $('certificate-dialog');
  const tabButtons = document.querySelectorAll('.tab-btn');

  const isAluno = () => currentUser?.tipo === 'aluno';
  const isProfessor = () => currentUser?.tipo === 'professor';
  const isAdmin = () => currentUser?.tipo === 'admin';
  const canManage = () => isProfessor() || isAdmin();

  // =========================================================
  // MODO ESCURO
  // =========================================================
  function syncThemeUI() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const labelText = isDark ? 'Modo Claro' : 'Modo Escuro';
    const ariaText = isDark ? 'Ativar modo claro' : 'Ativar modo escuro';

    ['theme-toggle', 'login-theme-toggle'].forEach((btnId) => {
      const btn = $(btnId);
      if (btn) {
        btn.setAttribute('aria-pressed', String(isDark));
        btn.setAttribute('aria-label', ariaText);
      }
    });
    ['theme-label', 'login-theme-label'].forEach((lblId) => {
      const lbl = $(lblId);
      if (lbl) lbl.textContent = labelText;
    });
  }

  function toggleTheme() {
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('ifeventos_theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ifeventos_theme', 'dark');
    }
    syncThemeUI();
  }

  $('theme-toggle').addEventListener('click', toggleTheme);
  $('login-theme-toggle').addEventListener('click', toggleTheme);
  syncThemeUI();

  // =========================================================
  // UTILITÁRIOS
  // =========================================================
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function showToast(message, type = 'success') {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3800);
  }

  function setFieldError(fieldId, message) {
    const input = $(fieldId);
    const errorEl = $(`error-${fieldId}`);
    if (input && /^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName)) input.classList.toggle('input-error', Boolean(message));
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.classList.toggle('visible', Boolean(message));
  }

  function fmtDateTime(str, opts = { dateStyle: 'short', timeStyle: 'short' }) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? str : d.toLocaleString('pt-BR', opts);
  }

  function fmtSessao(s) {
    const ini = new Date(s.inicio);
    const fim = new Date(ini.getTime() + s.duracaoMinutos * 60000);
    const dia = ini.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${dia}, ${hora(ini)} às ${hora(fim)}`;
  }

  function fmtMinutos(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h} h ${m} min`;
    return h ? `${h} h` : `${m} min`;
  }

  const ministrantesTexto = (evt) => evt.ministrantes.map((m) => m.nome).join(', ') || 'NÃO INFORMADO';

  function quandoTexto(evt) {
    const extra = evt.sessoes.length > 1 ? ` (+${evt.sessoes.length - 1} sessão${evt.sessoes.length > 2 ? 'ões' : ''})` : '';
    return fmtDateTime(evt.dataHora) + extra;
  }

  function statusBadge(status) {
    return `<span class="badge-status status-${escapeHTML(status)}">${escapeHTML(STATUS_LABEL[status] || status)}</span>`;
  }

  function tipoBadge(tipo) {
    return `<span class="badge-category badge-${escapeHTML(tipo)}">${escapeHTML(tipo)}</span>`;
  }

  // Confirmação genérica baseada em <dialog> (substitui window.confirm)
  let confirmResolve = null;
  function askConfirm({ title = 'Confirmar', message, confirmLabel = 'Confirmar' }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $('dialog-title').textContent = title;
      $('dialog-message').textContent = message;
      $('dialog-confirm').textContent = confirmLabel;
      confirmDialog.showModal();
    });
  }
  function settleConfirm(value) {
    if (confirmResolve) {
      const resolve = confirmResolve;
      confirmResolve = null;
      resolve(value);
    }
    if (confirmDialog.open) confirmDialog.close();
  }
  $('dialog-confirm').addEventListener('click', () => settleConfirm(true));
  $('dialog-cancel').addEventListener('click', () => settleConfirm(false));
  confirmDialog.addEventListener('close', () => settleConfirm(false));

  [detailDialog, confirmDialog, accountDialog, attendeesDialog, rejectDialog, certificateDialog].forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  });

  function handleLogout(msg = 'Sessão encerrada.') {
    ApiClient.clearSession();
    currentUser = null;
    events = [];
    manageEvents = [];
    lookupsLoaded = false;
    editingEventId = null;
    resetAllFilters();
    switchAuthView('login-aluno');
    appShell.hidden = true;
    loginScreen.hidden = false;
    if (msg) showToast(msg, 'warning');
  }

  // =========================================================
  // AUTENTICAÇÃO (LOGIN ÚNICO / CADASTRO POR TIPO)
  // =========================================================
  const AUTH_FIELDS = [
    'login-email', 'login-password',
    'reg-name', 'reg-email', 'reg-password', 'reg-password-confirm',
    'reg-matricula', 'reg-curso', 'reg-periodo', 'reg-siape', 'reg-departamento', 'reg-titulacao'
  ];

  function switchAuthView(target, notice = '') {
    viewLoginAluno.hidden = target !== 'login-aluno';
    viewRegisterAluno.hidden = target !== 'register-aluno';
    AUTH_FIELDS.forEach((id) => setFieldError(id, ''));

    const noticeBox = $('login-notice');
    noticeBox.textContent = notice;
    noticeBox.hidden = !notice;

    if (target === 'login-aluno') $('login-email').focus();
    else if (target === 'register-aluno') $('reg-name').focus();
  }

  document.querySelectorAll('[data-auth-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchAuthView(btn.dataset.authView));
  });

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.togglePassword);
      if (!input) return;
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      btn.setAttribute('aria-label', hidden ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  [...AUTH_FIELDS, 'current-password', 'new-password', 'confirm-new-password'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', () => setFieldError(id, ''));
  });

  const regTipo = () => document.querySelector('input[name="reg-tipo"]:checked').value;

  function syncRegisterType() {
    const professor = regTipo() === 'professor';
    $('reg-fields-aluno').hidden = professor;
    $('reg-fields-professor').hidden = !professor;
    $('reg-email').placeholder = professor ? 'seu.nome@ifpb.edu.br' : 'seu.nome@academico.ifpb.edu.br';
    $('reg-email-hint').innerHTML = professor
      ? 'Obrigatório terminar com <strong>@ifpb.edu.br</strong>'
      : 'Obrigatório terminar com <strong>@academico.ifpb.edu.br</strong>';
    $('btn-register-submit').textContent = professor ? 'Solicitar Cadastro' : 'Cadastrar e Entrar';
    AUTH_FIELDS.forEach((id) => setFieldError(id, ''));
  }
  document.querySelectorAll('input[name="reg-tipo"]').forEach((r) => r.addEventListener('change', syncRegisterType));

  formLoginAluno.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError('login-email', '');
    setFieldError('login-password', '');

    const email = $('login-email').value.trim().toLowerCase();
    const senha = $('login-password').value;

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFieldError('login-email', 'Informe seu e-mail institucional completo.');
      $('login-email').focus();
      return;
    }
    if (!senha) {
      setFieldError('login-password', 'Informe sua senha.');
      $('login-password').focus();
      return;
    }

    try {
      const data = await ApiClient.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) });
      ApiClient.setSession(data.token, data.user);
      currentUser = data.user;
      formLoginAluno.reset();
      await enterApplication();
      showToast(`Bem-vindo(a), ${currentUser.nome}!`);
    } catch (err) {
      setFieldError('login-password', err.message);
    }
  });

  formRegisterAluno.addEventListener('submit', async (e) => {
    e.preventDefault();
    AUTH_FIELDS.forEach((id) => setFieldError(id, ''));

    const tipo = regTipo();
    const nome = $('reg-name').value.trim();
    const email = $('reg-email').value.trim().toLowerCase();
    const senha = $('reg-password').value;
    const confirmar = $('reg-password-confirm').value;

    const erros = [];
    const falha = (id, msg) => erros.push([id, msg]);

    if (!/[a-zA-ZÀ-ÿ]{3,}/.test(nome)) falha('reg-name', 'Informe seu Nome ou Nome Social (mínimo 3 letras).');

    const dominio = tipo === 'professor' ? /^[a-zA-Z0-9._-]+@ifpb\.edu\.br$/i : /^[a-zA-Z0-9._-]+@academico\.ifpb\.edu\.br$/i;
    if (!dominio.test(email)) {
      falha('reg-email', tipo === 'professor'
        ? 'Professores devem usar e-mail terminado em @ifpb.edu.br.'
        : 'Alunos devem usar e-mail terminado em @academico.ifpb.edu.br.');
    }

    const corpo = { tipo, nome, email, senha };
    if (tipo === 'aluno') {
      corpo.matricula = $('reg-matricula').value.trim();
      corpo.curso = $('reg-curso').value.trim();
      corpo.periodo = $('reg-periodo').value;
      if (!/^\d{6,14}$/.test(corpo.matricula)) falha('reg-matricula', 'Informe a matrícula (6 a 14 dígitos).');
      if (corpo.curso.length < 3) falha('reg-curso', 'Informe o seu curso.');
      if (corpo.periodo !== '' && (Number(corpo.periodo) < 1 || Number(corpo.periodo) > 12)) falha('reg-periodo', 'O período deve estar entre 1 e 12.');
    } else {
      corpo.siape = $('reg-siape').value.trim();
      corpo.departamento = $('reg-departamento').value.trim();
      corpo.titulacao = $('reg-titulacao').value;
      if (!/^\d{5,10}$/.test(corpo.siape)) falha('reg-siape', 'Informe o SIAPE (5 a 10 dígitos).');
      if (corpo.departamento.length < 3) falha('reg-departamento', 'Informe seu departamento ou coordenação.');
      if (!corpo.titulacao) falha('reg-titulacao', 'Selecione a titulação.');
    }

    if (senha.length < 6) falha('reg-password', 'Crie uma senha com pelo menos 6 caracteres.');
    if (senha !== confirmar) falha('reg-password-confirm', 'As senhas digitadas não coincidem.');

    if (erros.length) {
      erros.forEach(([id, msg]) => setFieldError(id, msg));
      $(erros[0][0]).focus();
      return;
    }

    try {
      const data = await ApiClient.request('/api/auth/register', { method: 'POST', body: JSON.stringify(corpo) });

      if (data.pendente) {
        formRegisterAluno.reset();
        syncRegisterType();
        switchAuthView('login-aluno', data.message);
        return;
      }

      ApiClient.setSession(data.token, data.user);
      currentUser = data.user;
      formRegisterAluno.reset();
      await enterApplication();
      showToast(`Cadastro criado! Bem-vindo(a), ${currentUser.nome}.`);
    } catch (err) {
      const alvo = err.status === 409
        ? (/matr/i.test(err.message) ? 'reg-matricula' : /siape/i.test(err.message) ? 'reg-siape' : 'reg-email')
        : 'reg-password-confirm';
      setFieldError(alvo, err.message);
      $(alvo).focus();
    }
  });

  $('logout-btn').addEventListener('click', () => handleLogout());

  // =========================================================
  // ENTRADA NA APLICAÇÃO
  // =========================================================
  async function enterApplication() {
    if (!currentUser || !ApiClient.getToken()) {
      loginScreen.hidden = false;
      appShell.hidden = true;
      return;
    }

    try {
      const me = await ApiClient.request('/api/auth/me');
      currentUser = me.user;
      ApiClient.setSession(ApiClient.getToken(), currentUser);

      loginScreen.hidden = true;
      appShell.hidden = false;

      $('header-user-name').textContent = currentUser.nome;
      $('header-user-role').textContent = TIPO_USUARIO_LABEL[currentUser.tipo];

      $('tab-btn-manage').hidden = !canManage();
      $('tab-btn-manage').textContent = isAdmin() ? 'Gerenciar Eventos' : 'Meus Eventos';
      $('manage-title').textContent = isAdmin() ? 'Gerenciar Eventos' : 'Meus Eventos';
      $('manage-subtitle').textContent = isAdmin()
        ? 'Aprove, rejeite e acompanhe todos os eventos do câmpus.'
        : 'Acompanhe o andamento dos eventos que você criou.';
      $('tab-btn-register').hidden = !canManage();
      $('tab-btn-certs').hidden = !isAluno();
      $('tab-btn-users').hidden = !isAdmin();
      statCardInscritos.hidden = !isAluno();
      $('rascunho-wrap').hidden = !isProfessor();
      $('event-form-subtitle').textContent = isAdmin()
        ? 'Eventos cadastrados por administradores são publicados imediatamente.'
        : 'Eventos de professores passam pela aprovação de um administrador antes de aparecerem no catálogo.';
      $('btn-event-submit').textContent = isAdmin() ? 'Salvar e Publicar Evento' : 'Enviar para Aprovação';

      switchTab('events');
    } catch (err) {
      handleLogout('Sua sessão expirou. Faça login novamente.');
    }
  }

  async function fetchCatalog() {
    try {
      const data = await ApiClient.request('/api/eventos');
      events = data.eventos || [];
      renderEvents();
    } catch (err) {
      if (err.status === 401 || err.status === 403) handleLogout('Sessão inválida. Entre novamente.');
      else showToast(err.message, 'warning');
    }
  }

  // =========================================================
  // CONTA (SENHA / EXCLUSÃO)
  // =========================================================
  $('open-account-btn').addEventListener('click', () => {
    if (!currentUser) return;

    $('acc-name').textContent = currentUser.nome;
    $('acc-email').textContent = currentUser.email;
    $('acc-role').textContent = TIPO_USUARIO_LABEL[currentUser.tipo];

    const linhas = [];
    if (isAluno()) {
      linhas.push(['Matrícula', currentUser.matricula], ['Curso', currentUser.curso]);
      if (currentUser.periodo) linhas.push(['Período', `${currentUser.periodo}º`]);
    } else if (isProfessor()) {
      linhas.push(['SIAPE', currentUser.siape], ['Departamento', currentUser.departamento], ['Titulação', currentUser.titulacao]);
    }
    $('acc-extra').innerHTML = linhas.map(([k, v]) => `<p><strong>${k}:</strong> ${escapeHTML(v)}</p>`).join('');

    $('form-change-password').reset();
    ['current-password', 'new-password', 'confirm-new-password'].forEach((id) => setFieldError(id, ''));
    $('student-delete-zone').hidden = isAdmin();
    accountDialog.showModal();
  });

  $('account-close-x').addEventListener('click', () => accountDialog.close());

  $('form-change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    ['current-password', 'new-password', 'confirm-new-password'].forEach((id) => setFieldError(id, ''));

    const senhaAtual = $('current-password').value;
    const novaSenha = $('new-password').value;
    const confirmarNova = $('confirm-new-password').value;
    const minLen = isAdmin() ? 4 : 6;
    let erro = false;

    if (!senhaAtual) { setFieldError('current-password', 'Informe sua senha atual.'); erro = true; }
    if (novaSenha.length < minLen) { setFieldError('new-password', `A nova senha deve ter pelo menos ${minLen} caracteres.`); erro = true; }
    if (novaSenha !== confirmarNova) { setFieldError('confirm-new-password', 'A confirmação da nova senha não coincide.'); erro = true; }
    if (erro) return;

    try {
      const data = await ApiClient.request('/api/auth/password', { method: 'PUT', body: JSON.stringify({ senhaAtual, novaSenha }) });
      $('form-change-password').reset();
      accountDialog.close();
      showToast(data.message);
    } catch (err) {
      setFieldError('current-password', err.message);
    }
  });

  $('btn-delete-own-account').addEventListener('click', async () => {
    accountDialog.close();
    const ok = await askConfirm({
      title: 'Excluir minha conta',
      message: 'Tem certeza que deseja excluir permanentemente sua conta? Suas inscrições serão canceladas e as vagas liberadas.',
      confirmLabel: 'Excluir conta'
    });
    if (!ok) return;
    try {
      await ApiClient.request('/api/auth/me', { method: 'DELETE' });
      handleLogout('Sua conta foi excluída do sistema.');
    } catch (err) {
      showToast(err.message, 'warning');
    }
  });

  // =========================================================
  // NAVEGAÇÃO ENTRE ABAS
  // =========================================================
  function switchTab(tabName) {
    const permitido = {
      events: true, manage: canManage(), register: canManage(), certs: isAluno(), users: isAdmin()
    };
    if (!permitido[tabName]) return;

    currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
    tabButtons.forEach((btn) => {
      const alvo = btn.dataset.tab === tabName;
      btn.classList.toggle('active', alvo);
      btn.setAttribute('aria-selected', String(alvo));
    });
    $(`tab-${tabName}`).classList.add('active');

    if (tabName === 'events') fetchCatalog();
    else if (tabName === 'manage') fetchManage();
    else if (tabName === 'certs') fetchCertificates();
    else if (tabName === 'users') fetchUsers();
    else if (tabName === 'register') prepareEventForm();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'register' && editingEventId) resetEventForm();
      switchTab(btn.dataset.tab);
    });
  });

  // =========================================================
  // CATÁLOGO: FILTROS E CARDS
  // =========================================================
  function matchesDatePeriod(datetimeStr, period) {
    if (period === 'todos') return true;
    const evtDate = new Date(datetimeStr);
    if (isNaN(evtDate.getTime())) return true;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dia = 24 * 60 * 60 * 1000;

    if (period === 'hoje') return evtDate >= startOfToday && evtDate < new Date(startOfToday.getTime() + dia);
    if (period === 'semana') return evtDate >= startOfToday && evtDate <= new Date(startOfToday.getTime() + 7 * dia);
    if (period === 'mes') return evtDate >= startOfToday && evtDate <= new Date(startOfToday.getTime() + 30 * dia);
    return true;
  }

  function resetAllFilters() {
    searchInput.value = '';
    filterCategory.value = 'todos';
    filterDate.value = 'todos';
    onlySubscribed = false;
    statCardInscritos.classList.remove('active-filter');
    statCardInscritos.setAttribute('aria-pressed', 'false');
    $('stat-inscritos-hint').textContent = 'Filtrar';
    if (currentUser) renderEvents();
  }

  function updateStats() {
    $('stat-total').textContent = events.length;
    $('stat-vagas').textContent = events
      .filter((e) => e.status === 'aprovado' && !e.jaComecou)
      .reduce((acc, e) => acc + e.vagasLivres, 0);
    $('stat-inscritos').textContent = events.filter((e) => e.minhaInscricao).length;
  }

  function capacityHTML(evt, comProgress = true) {
    const total = evt.vagasTotais;
    const pct = total > 0 ? Math.min(100, Math.round((evt.inscritos / total) * 100)) : 100;
    const barClass = evt.vagasLivres === 0 ? 'full' : (pct >= 75 ? 'warning' : '');
    const texto = evt.vagasLivres === 0
      ? `Vagas esgotadas${evt.listaEspera ? ` • ${evt.listaEspera} na lista de espera` : ''}`
      : `${evt.vagasLivres} de ${total} vaga(s) livre(s)`;
    return `
      <div class="capacity-wrapper">
        <div class="capacity-header">
          <span class="seats-count ${evt.vagasLivres <= 5 ? 'low' : ''}">${escapeHTML(texto)}</span>
          <span class="capacity-percent">${pct}% ocupado</span>
        </div>
        ${comProgress ? `<div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill ${barClass}" style="width: ${pct}%"></div>
        </div>` : ''}
      </div>`;
  }

  // Estado da ação principal do aluno em um evento
  function acaoAluno(evt) {
    if (evt.certificado) return { kind: 'view-cert', label: 'Ver certificado', cls: 'btn-subscribe' };
    if (evt.elegivelCertificado) return { kind: 'emit', label: 'Emitir certificado', cls: 'btn-subscribe' };
    if (evt.minhaInscricao) {
      return evt.jaComecou || evt.status === 'encerrado'
        ? { kind: 'none', label: 'Ver detalhes', cls: 'btn-subscribe' }
        : { kind: 'toggle', label: evt.minhaInscricao === 'lista_espera' ? 'Sair da lista de espera' : 'Cancelar inscrição', cls: 'btn-unsubscribe' };
    }
    if (evt.status === 'encerrado' || evt.jaComecou) return { kind: 'none', label: 'Inscrições encerradas', cls: 'btn-subscribe', disabled: true };
    if (evt.vagasLivres === 0) return { kind: 'toggle', label: 'Entrar na lista de espera', cls: 'btn-subscribe' };
    return { kind: 'toggle', label: 'Garantir Vaga', cls: 'btn-subscribe' };
  }

  function renderEvents() {
    const busca = searchInput.value.toLowerCase().trim();
    const tipo = filterCategory.value;
    const periodo = filterDate.value;
    const filtrosAtivos = busca !== '' || tipo !== 'todos' || periodo !== 'todos' || onlySubscribed;
    btnClearTop.hidden = !filtrosAtivos;

    eventsGrid.innerHTML = '';

    const lista = events
      .filter((e) => {
        const textoBusca = `${e.titulo} ${ministrantesTexto(e)} ${e.local.nome}`.toLowerCase();
        return textoBusca.includes(busca)
          && (tipo === 'todos' || e.tipo === tipo)
          && matchesDatePeriod(e.dataHora, periodo)
          && (!onlySubscribed || e.minhaInscricao);
      })
      .sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora));

    $('results-summary').textContent = `${lista.length} evento(s) exibido(s) em ordem cronológica • Clique em um evento para ver os detalhes`;

    if (lista.length === 0) {
      eventsGrid.innerHTML = `
        <div class="empty-state">
          <p>Nenhum evento acadêmico encontrado com os critérios selecionados.</p>
          ${filtrosAtivos ? '<button type="button" class="btn-reset-filters" data-action="reset-filters">Limpar filtros</button>' : ''}
        </div>`;
      updateStats();
      return;
    }

    lista.forEach((evt) => {
      const card = document.createElement('article');
      card.className = `event-card ${evt.minhaInscricao === 'confirmada' ? 'is-subscribed' : ''}`;
      card.dataset.eventId = evt.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      const acao = isAluno() ? acaoAluno(evt) : { label: 'Ver detalhes', cls: 'btn-subscribe' };

      card.innerHTML = `
        <div>
          <div class="card-badges">
            ${tipoBadge(evt.tipo)}
            ${evt.status === 'encerrado' ? statusBadge('encerrado') : ''}
            ${evt.minhaInscricao === 'confirmada' ? '<span class="badge-subscribed">Inscrito</span>' : ''}
            ${evt.minhaInscricao === 'lista_espera' ? '<span class="badge-waitlist">Lista de espera</span>' : ''}
          </div>
          <h3>${escapeHTML(evt.titulo)}</h3>
          <div class="event-details">
            <p><strong>Ministrante(s):</strong> ${escapeHTML(ministrantesTexto(evt))}</p>
            <p><strong>Data/Hora:</strong> ${escapeHTML(quandoTexto(evt))}</p>
            <p><strong>Local:</strong> ${escapeHTML(evt.local.nome)}</p>
          </div>
        </div>
        <div class="event-footer">
          ${capacityHTML(evt)}
          <div class="card-actions">
            <button type="button" class="${acao.cls}" data-action="open-detail" data-id="${evt.id}" ${acao.disabled ? 'disabled' : ''}>
              ${escapeHTML(acao.label)}
            </button>
          </div>
        </div>`;
      eventsGrid.appendChild(card);
    });

    updateStats();
  }

  // =========================================================
  // DETALHES DO EVENTO E INSCRIÇÃO
  // =========================================================
  function detalhesPorTipoHTML(evt) {
    const d = evt.detalhes;
    const linha = (rotulo, valor) => (valor ? `<p><strong>${rotulo}:</strong> ${escapeHTML(valor)}</p>` : '');
    if (evt.tipo === 'Minicurso') {
      return linha('Carga horária', `${d.cargaHoraria} h`) + linha('Nível', NIVEL_LABEL[d.nivel])
        + linha('Pré-requisitos', d.preRequisitos) + linha('Frequência mínima para certificado', `${d.frequenciaMinima}%`);
    }
    if (evt.tipo === 'Palestra') {
      const mostraLink = d.linkTransmissao && (evt.minhaInscricao === 'confirmada' || evt.podeGerenciar);
      return linha('Público-alvo', d.publicoAlvo)
        + (mostraLink ? `<p><strong>Transmissão:</strong> <a href="${escapeHTML(d.linkTransmissao)}" target="_blank" rel="noopener noreferrer">${escapeHTML(d.linkTransmissao)}</a></p>` : '')
        + (d.linkTransmissao && !mostraLink ? '<p><strong>Transmissão:</strong> link liberado para inscritos</p>' : '');
    }
    return linha('Materiais necessários', d.materiais) + linha('Pessoas por equipe', String(d.vagasPorEquipe))
      + linha('Entrega final', d.entregaFinal);
  }

  let detailAction = 'none';

  function openEventDetailModal(id) {
    const evt = events.find((item) => item.id === id);
    if (!evt) return;
    activeDetailEventId = id;

    $('detail-badges').innerHTML = `
      ${tipoBadge(evt.tipo)}
      ${evt.status === 'encerrado' ? statusBadge('encerrado') : ''}
      ${evt.minhaInscricao === 'confirmada' ? '<span class="badge-subscribed">Inscrição Confirmada</span>' : ''}
      ${evt.minhaInscricao === 'lista_espera' ? '<span class="badge-waitlist">Lista de espera</span>' : ''}`;

    $('detail-title').textContent = evt.titulo;
    $('detail-description').textContent = evt.descricao || 'Atividade acadêmica institucional promovida pelo Câmpus IFPB.';

    $('detail-info').innerHTML = `
      <p><strong>Ministrante(s):</strong> ${escapeHTML(ministrantesTexto(evt))}</p>
      <p><strong>Local:</strong> ${escapeHTML(evt.local.nome)}</p>
      <p><strong>${evt.sessoes.length > 1 ? 'Sessões' : 'Data e Horário'}:</strong></p>
      <ul class="session-list">${evt.sessoes.map((s) => `<li>${escapeHTML(fmtSessao(s))}</li>`).join('')}</ul>
      ${detalhesPorTipoHTML(evt)}`;

    $('detail-capacity').innerHTML = capacityHTML(evt);

    const promptBox = $('detail-prompt-box');
    const actionBtn = $('detail-action-btn');
    actionBtn.hidden = false;
    actionBtn.disabled = false;
    actionBtn.className = 'btn-dialog-primary';
    promptBox.className = 'detail-prompt-box';

    if (!isAluno()) {
      promptBox.textContent = 'Somente alunos podem se inscrever em eventos.';
      actionBtn.hidden = true;
      detailAction = 'none';
    } else {
      const acao = acaoAluno(evt);
      detailAction = acao.kind;
      actionBtn.textContent = acao.label;
      actionBtn.disabled = Boolean(acao.disabled);
      if (acao.kind === 'none') actionBtn.hidden = true;

      const freq = evt.minhaFrequencia;
      const freqTexto = freq && evt.sessoes.length
        ? ` Sua frequência: ${freq.presentes} de ${freq.total} sessão(ões) (${freq.percentual}%) — mínimo de ${freq.minimo}% para o certificado.` : '';

      if (evt.certificado) {
        promptBox.className = 'detail-prompt-box subscribed-state';
        promptBox.textContent = `Seu certificado já foi emitido (código ${evt.certificado.codigo}).`;
      } else if (evt.elegivelCertificado) {
        promptBox.className = 'detail-prompt-box';
        promptBox.textContent = `Você cumpriu a frequência mínima e pode emitir seu certificado.${freqTexto}`;
      } else if (evt.minhaInscricao === 'confirmada') {
        promptBox.className = 'detail-prompt-box subscribed-state';
        promptBox.textContent = evt.jaComecou
          ? `Você está inscrito neste evento.${freqTexto}`
          : `Você (${currentUser.nome}) está inscrito neste evento. Deseja cancelar e liberar sua vaga?`;
        if (evt.jaComecou) actionBtn.hidden = true;
        else actionBtn.classList.add('cancel-mode');
      } else if (evt.minhaInscricao === 'lista_espera') {
        promptBox.className = 'detail-prompt-box subscribed-state';
        promptBox.textContent = 'Você está na lista de espera e será promovido(a) automaticamente se uma vaga abrir.';
        actionBtn.classList.add('cancel-mode');
      } else if (evt.status === 'encerrado' || evt.jaComecou) {
        promptBox.className = 'detail-prompt-box subscribed-state';
        promptBox.textContent = 'As inscrições deste evento estão encerradas.';
      } else if (evt.vagasLivres === 0) {
        promptBox.textContent = 'As vagas acabaram, mas você pode entrar na lista de espera e será avisado(a) na própria plataforma quando uma vaga abrir.';
      } else {
        promptBox.textContent = `Deseja confirmar sua presença como ${currentUser.nome} e reservar uma vaga neste evento?`;
      }
    }

    detailDialog.showModal();
  }

  function closeEventDetailModal() {
    activeDetailEventId = null;
    detailDialog.close();
  }

  async function toggleSubscription(id) {
    try {
      const data = await ApiClient.request(`/api/eventos/${id}/inscricao`, { method: 'POST' });
      await fetchCatalog();
      showToast(data.message, data.status === 'confirmada' ? 'success' : 'warning');
    } catch (err) {
      showToast(err.message, 'warning');
      await fetchCatalog();
    }
  }

  async function emitCertificate(id) {
    try {
      const data = await ApiClient.request(`/api/eventos/${id}/certificado`, { method: 'POST' });
      await fetchCatalog();
      if (currentTab === 'certs') await fetchCertificates();
      showCertificate(data.certificado);
      if (data.message) showToast(data.message);
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  $('detail-action-btn').addEventListener('click', async () => {
    if (activeDetailEventId === null) return;
    const id = activeDetailEventId;
    const evt = events.find((e) => e.id === id);
    closeEventDetailModal();

    if (detailAction === 'toggle') await toggleSubscription(id);
    else if (detailAction === 'emit') await emitCertificate(id);
    else if (detailAction === 'view-cert' && evt?.certificado) await emitCertificate(id);
  });

  $('detail-cancel-btn').addEventListener('click', closeEventDetailModal);
  $('detail-close-x').addEventListener('click', closeEventDetailModal);

  eventsGrid.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reset-filters"]')) {
      resetAllFilters();
      return;
    }
    const card = e.target.closest('.event-card');
    if (card) openEventDetailModal(Number(card.dataset.eventId));
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

  function toggleMySubscriptionsFilter() {
    onlySubscribed = !onlySubscribed;
    statCardInscritos.classList.toggle('active-filter', onlySubscribed);
    statCardInscritos.setAttribute('aria-pressed', String(onlySubscribed));
    $('stat-inscritos-hint').textContent = onlySubscribed ? 'Ativo (ver todos)' : 'Filtrar';
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

  // =========================================================
  // CERTIFICADOS (ALUNO)
  // =========================================================
  function showCertificate(c) {
    if (!c) return;
    $('certificate-body').innerHTML = `
      <div class="certificate">
        <p class="cert-org">Instituto Federal da Paraíba • IFEventos</p>
        <h2>Certificado de Participação</h2>
        <p>Certificamos que</p>
        <p class="cert-name">${escapeHTML(c.aluno)}</p>
        <p class="cert-text">
          participou d${c.tipo === 'Palestra' ? 'a' : 'o'} ${escapeHTML(c.tipo.toLowerCase())}
          <strong>${escapeHTML(c.titulo)}</strong>, realizad${c.tipo === 'Palestra' ? 'a' : 'o'} em
          ${escapeHTML(fmtDateTime(c.dataHora, { dateStyle: 'long' }))}, em ${escapeHTML(c.local)},
          com carga horária de ${escapeHTML(fmtMinutos(c.cargaHorariaMinutos))}.
        </p>
        <p class="cert-code">Código de verificação: <strong>${escapeHTML(c.codigo)}</strong></p>
        <p class="cert-verify">${escapeHTML(location.origin)}/api/certificados/verificar/${escapeHTML(c.codigo)}</p>
      </div>`;
    certificateDialog.showModal();
  }

  $('certificate-close').addEventListener('click', () => certificateDialog.close());
  $('certificate-print').addEventListener('click', () => window.print());

  async function fetchCertificates() {
    try {
      const [catalogo, meus] = await Promise.all([
        ApiClient.request('/api/eventos'),
        ApiClient.request('/api/certificados/meus')
      ]);
      events = catalogo.eventos || [];
      const disponiveis = events.filter((e) => e.elegivelCertificado);

      $('certs-available').innerHTML = disponiveis.length
        ? disponiveis.map((e) => `
          <article class="manage-item">
            <div class="manage-main">
              <div class="card-badges">${tipoBadge(e.tipo)}</div>
              <h3>${escapeHTML(e.titulo)}</h3>
              <p class="manage-meta">Frequência: ${e.minhaFrequencia.presentes}/${e.minhaFrequencia.total} sessão(ões) (${e.minhaFrequencia.percentual}%)</p>
            </div>
            <div class="manage-actions"><button type="button" class="btn-subscribe" data-cert-action="emit" data-id="${e.id}">Emitir certificado</button></div>
          </article>`).join('')
        : '<p class="field-hint">Nenhum certificado disponível para emissão no momento.</p>';

      const emitidos = meus.certificados || [];
      $('certs-issued').innerHTML = emitidos.length
        ? emitidos.map((c) => `
          <article class="manage-item">
            <div class="manage-main">
              <div class="card-badges">${tipoBadge(c.tipo)}</div>
              <h3>${escapeHTML(c.titulo)}</h3>
              <p class="manage-meta">${escapeHTML(fmtMinutos(c.cargaHorariaMinutos))} • código ${escapeHTML(c.codigo)}</p>
            </div>
            <div class="manage-actions"><button type="button" class="btn-mini btn-mini-reset" data-cert-action="view" data-codigo="${escapeHTML(c.codigo)}">Ver certificado</button></div>
          </article>`).join('')
        : '<p class="field-hint">Você ainda não emitiu certificados.</p>';

      certsCache = emitidos;
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  let certsCache = [];
  $('tab-certs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cert-action]');
    if (!btn) return;
    if (btn.dataset.certAction === 'emit') emitCertificate(Number(btn.dataset.id));
    else showCertificate(certsCache.find((c) => c.codigo === btn.dataset.codigo));
  });

  // =========================================================
  // GERENCIAR EVENTOS (PROFESSOR / ADMIN)
  // =========================================================
  async function fetchManage() {
    try {
      const data = await ApiClient.request('/api/eventos?escopo=gerenciar');
      manageEvents = data.eventos || [];
      renderManage();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  function botoesGerenciar(e) {
    const b = [];
    const btn = (acao, rotulo, cls = 'btn-mini-reset') =>
      `<button type="button" class="btn-mini ${cls}" data-manage-action="${acao}" data-id="${e.id}">${rotulo}</button>`;

    if (isAdmin() && e.status === 'pendente') {
      b.push(btn('aprovar', 'Aprovar'), btn('rejeitar', 'Rejeitar', 'btn-mini-del'));
    }
    if (e.podeGerenciar && ['rascunho', 'rejeitado'].includes(e.status)) b.push(btn('enviar', 'Enviar p/ aprovação'));
    const editavel = ['rascunho', 'pendente', 'rejeitado'].includes(e.status) || (isAdmin() && e.status === 'aprovado');
    if (e.podeGerenciar && editavel) b.push(btn('editar', 'Editar'));
    if (e.podeGerenciar && ['aprovado', 'encerrado'].includes(e.status)) b.push(btn('inscritos', 'Inscritos e presenças'));
    if (e.podeGerenciar && e.status === 'aprovado') b.push(btn('encerrar', 'Encerrar'));
    if (e.podeGerenciar && ['rascunho', 'pendente', 'aprovado'].includes(e.status)) b.push(btn('cancelar', 'Cancelar evento', 'btn-mini-del'));
    const podeExcluir = isAdmin() || ['rascunho', 'pendente', 'rejeitado', 'cancelado'].includes(e.status);
    if (e.podeGerenciar && podeExcluir) b.push(btn('excluir', 'Excluir', 'btn-mini-del'));
    return b.join('');
  }

  function renderManage() {
    const filtro = $('manage-status-filter').value;
    const lista = manageEvents
      .filter((e) => filtro === 'todos' || e.status === filtro)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || new Date(a.dataHora) - new Date(b.dataHora));

    if (lista.length === 0) {
      $('manage-list').innerHTML = '<div class="empty-state"><p>Nenhum evento nesta situação.</p></div>';
      return;
    }

    $('manage-list').innerHTML = lista.map((e) => `
      <article class="manage-item">
        <div class="manage-main">
          <div class="card-badges">${tipoBadge(e.tipo)}${statusBadge(e.status)}</div>
          <h3>${escapeHTML(e.titulo)}</h3>
          <p class="manage-meta">${escapeHTML(quandoTexto(e))} • ${escapeHTML(e.local.nome)}</p>
          <p class="manage-meta">Ministrante(s): ${escapeHTML(ministrantesTexto(e))}</p>
          <p class="manage-meta">Inscritos: ${e.inscritos}/${e.vagasTotais}${e.listaEspera ? ` • Lista de espera: ${e.listaEspera}` : ''}</p>
          ${e.status === 'rejeitado' && e.justificativaRejeicao
            ? `<p class="reject-note"><strong>Justificativa da rejeição:</strong> ${escapeHTML(e.justificativaRejeicao)}</p>` : ''}
        </div>
        <div class="manage-actions">${botoesGerenciar(e)}</div>
      </article>`).join('');
  }

  $('manage-status-filter').addEventListener('change', renderManage);

  async function acaoEvento(id, acao, extra = {}) {
    try {
      const res = await ApiClient.request(`/api/eventos/${id}/acao`, { method: 'PUT', body: JSON.stringify({ acao, ...extra }) });
      showToast(res.message, ['cancelar', 'rejeitar'].includes(acao) ? 'warning' : 'success');
      await fetchManage();
      return true;
    } catch (err) {
      showToast(err.message, 'warning');
      return false;
    }
  }

  $('manage-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-manage-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const evt = manageEvents.find((x) => x.id === id);
    if (!evt) return;

    switch (btn.dataset.manageAction) {
      case 'editar':
        await fillFormForEdit(evt);
        break;
      case 'enviar':
        await acaoEvento(id, 'enviar');
        break;
      case 'aprovar':
        await acaoEvento(id, 'aprovar');
        break;
      case 'rejeitar':
        rejectTargetId = id;
        $('reject-message').textContent = `Rejeitar o evento "${evt.titulo}"? O professor poderá ajustar e reenviar.`;
        $('reject-reason').value = '';
        setFieldError('reject-reason', '');
        rejectDialog.showModal();
        break;
      case 'cancelar':
        if (await askConfirm({ title: 'Cancelar evento', message: `Cancelar o evento "${evt.titulo}"? Ele deixa de aparecer no catálogo.`, confirmLabel: 'Cancelar evento' })) {
          await acaoEvento(id, 'cancelar');
        }
        break;
      case 'encerrar':
        if (await askConfirm({ title: 'Encerrar evento', message: `Marcar "${evt.titulo}" como encerrado? Confira antes as presenças registradas.`, confirmLabel: 'Encerrar' })) {
          await acaoEvento(id, 'encerrar');
        }
        break;
      case 'inscritos':
        await openAttendees(id);
        break;
      case 'excluir':
        if (await askConfirm({ title: 'Excluir evento', message: `Excluir definitivamente "${evt.titulo}" e suas inscrições? Esta ação não pode ser desfeita.`, confirmLabel: 'Excluir' })) {
          try {
            const res = await ApiClient.request(`/api/eventos/${id}`, { method: 'DELETE' });
            showToast(res.message, 'warning');
            await fetchManage();
          } catch (err) {
            showToast(err.message, 'warning');
          }
        }
        break;
    }
  });

  $('reject-cancel').addEventListener('click', () => rejectDialog.close());
  $('reject-confirm').addEventListener('click', async () => {
    const justificativa = $('reject-reason').value.trim();
    if (justificativa.length < 5) {
      setFieldError('reject-reason', 'Informe uma justificativa com pelo menos 5 caracteres.');
      return;
    }
    const ok = await acaoEvento(rejectTargetId, 'rejeitar', { justificativa });
    if (ok) rejectDialog.close();
  });
  $('reject-reason').addEventListener('input', () => setFieldError('reject-reason', ''));

  // =========================================================
  // INSCRITOS E PRESENÇAS
  // =========================================================
  async function openAttendees(eventId) {
    try {
      attendeesEventId = eventId;
      const data = await ApiClient.request(`/api/eventos/${eventId}/inscritos`);
      renderAttendees(data);
      if (!attendeesDialog.open) attendeesDialog.showModal();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  function renderAttendees(data) {
    $('attendees-title').textContent = `Inscritos — ${data.evento.titulo}`;
    const confirmados = data.inscritos.filter((i) => i.status === 'confirmada').length;
    const espera = data.inscritos.length - confirmados;
    $('attendees-summary').textContent =
      `${confirmados}/${data.evento.vagasTotais} vagas preenchidas${espera ? ` • ${espera} na lista de espera` : ''}. A presença só pode ser marcada em sessões que já começaram.`;

    if (data.inscritos.length === 0) {
      $('attendees-table').innerHTML = '<div class="empty-state"><p>Nenhum aluno inscrito ainda.</p></div>';
      return;
    }

    const agora = new Date();
    const eventoAtivo = ['aprovado', 'encerrado'].includes(data.evento.status);
    const cab = data.sessoes.map((s, i) =>
      `<th title="${escapeHTML(fmtSessao(s))}">S${i + 1}<br><small>${escapeHTML(fmtDateTime(s.inicio, { day: '2-digit', month: '2-digit' }))}</small></th>`).join('');

    const linhas = data.inscritos.map((i) => {
      const confirmada = i.status === 'confirmada';
      const celulas = data.sessoes.map((s) => {
        const podeMarcar = confirmada && eventoAtivo && new Date(s.inicio) <= agora;
        return `<td><input type="checkbox" data-insc="${i.inscricaoId}" data-sessao="${s.id}"
                  ${i.presencas.includes(s.id) ? 'checked' : ''} ${podeMarcar ? '' : 'disabled'}
                  aria-label="Presença de ${escapeHTML(i.nome)} na sessão ${s.id}"></td>`;
      }).join('');
      const pct = data.sessoes.length ? Math.round((i.presencas.length / data.sessoes.length) * 100) : 0;
      return `
        <tr>
          <td><strong>${escapeHTML(i.nome)}</strong><br><small>${escapeHTML(i.matricula)} • ${escapeHTML(i.curso)}</small></td>
          <td>${confirmada ? '<span class="badge-subscribed">Confirmada</span>' : '<span class="badge-waitlist">Lista de espera</span>'}</td>
          ${celulas}
          <td>${confirmada ? `${pct}%` : '—'}</td>
          <td>${i.certificado ? `<small>${escapeHTML(i.certificado)}</small>` : '—'}</td>
        </tr>`;
    }).join('');

    $('attendees-table').innerHTML = `
      <table class="attendees-table">
        <thead><tr><th>Aluno</th><th>Situação</th>${cab}<th>Freq.</th><th>Certificado</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`;
  }

  $('attendees-table').addEventListener('change', async (e) => {
    const box = e.target.closest('input[type="checkbox"][data-insc]');
    if (!box) return;
    const marcado = box.checked;
    try {
      await ApiClient.request(`/api/eventos/${attendeesEventId}/presenca`, {
        method: 'PUT',
        body: JSON.stringify({ inscricaoId: Number(box.dataset.insc), sessaoId: Number(box.dataset.sessao), presente: marcado })
      });
      await openAttendees(attendeesEventId);
    } catch (err) {
      box.checked = !marcado;
      showToast(err.message, 'warning');
    }
  });

  $('attendees-close-x').addEventListener('click', () => attendeesDialog.close());

  // =========================================================
  // FORMULÁRIO DE EVENTO (CRIAR / EDITAR)
  // =========================================================
  function minDateTimeLocal() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }

  function addSessionRow(inicio = '', duracao = 120) {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.innerHTML = `
      <input type="datetime-local" class="session-inicio" min="${minDateTimeLocal()}" value="${escapeHTML(inicio)}" aria-label="Data e horário da sessão">
      <input type="number" class="session-duracao" min="15" max="720" step="5" value="${escapeHTML(duracao)}" aria-label="Duração em minutos">
      <span class="session-unit">min</span>
      <button type="button" class="btn-mini btn-mini-del session-remove" aria-label="Remover sessão">Remover</button>`;
    $('sessions-list').appendChild(row);
    refreshSessionRows();
  }

  function refreshSessionRows() {
    const rows = $('sessions-list').querySelectorAll('.session-row');
    rows.forEach((r) => { r.querySelector('.session-remove').hidden = rows.length === 1; });
  }

  $('btn-add-session').addEventListener('click', () => { addSessionRow(); setFieldError('sessions', ''); });
  $('sessions-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.session-remove');
    if (btn) { btn.closest('.session-row').remove(); refreshSessionRows(); }
  });
  $('sessions-list').addEventListener('input', () => { setFieldError('sessions', ''); setFieldError('event-form', ''); });

  async function loadLookups() {
    if (lookupsLoaded) return;
    const [l, p] = await Promise.all([ApiClient.request('/api/locais'), ApiClient.request('/api/professores')]);
    locais = l.locais || [];
    professores = p.professores || [];
    lookupsLoaded = true;

    $('local').innerHTML = locais
      .map((x) => `<option value="${x.id}">${escapeHTML(x.nome)} (cap. ${x.capacidade})</option>`).join('');
    $('ministrantes-prof').innerHTML = professores.map((x) => `
      <label class="check-inline">
        <input type="checkbox" name="min-prof" value="${x.id}" ${x.id === currentUser.id ? 'checked disabled' : ''}>
        <span>${escapeHTML(x.nome)} <small>${escapeHTML(x.departamento)}</small></span>
      </label>`).join('');
    syncLocalCapacity();
  }

  function syncLocalCapacity() {
    const local = locais.find((x) => x.id === Number($('local').value));
    if (local) {
      $('vagas').max = local.capacidade;
      $('vagas-hint').textContent = `Capacidade do local escolhido: ${local.capacidade} pessoas.`;
    }
  }
  $('local').addEventListener('change', () => { syncLocalCapacity(); setFieldError('local', ''); });

  function syncTipoFieldsets() {
    ['Minicurso', 'Palestra', 'Workshop'].forEach((t) => { $(`fs-${t}`).hidden = $('tipo').value !== t; });
  }
  $('tipo').addEventListener('change', syncTipoFieldsets);

  async function prepareEventForm() {
    try {
      await loadLookups();
    } catch (err) {
      showToast(err.message, 'warning');
    }
    if (!editingEventId && $('sessions-list').children.length === 0) addSessionRow();
    syncTipoFieldsets();
  }

  function resetEventForm() {
    editingEventId = null;
    eventForm.reset();
    $('event-id').value = '';
    $('tipo').disabled = false;
    $('sessions-list').innerHTML = '';
    addSessionRow();
    $('mc-freq').value = 75;
    $('wk-equipe').value = 1;
    document.querySelectorAll('input[name="min-prof"]').forEach((c) => { c.checked = c.disabled && Number(c.value) === currentUser?.id; });
    ['title', 'local', 'vagas', 'sessions', 'event-form'].forEach((id) => setFieldError(id, ''));
    $('event-form-title').textContent = 'Cadastrar Novo Evento Acadêmico';
    $('btn-event-submit').textContent = isAdmin() ? 'Salvar e Publicar Evento' : 'Enviar para Aprovação';
    $('btn-cancel-edit').hidden = true;
    syncTipoFieldsets();
    syncLocalCapacity();
  }

  async function fillFormForEdit(evt) {
    await loadLookups();
    resetEventForm();
    editingEventId = evt.id;
    $('event-id').value = evt.id;

    $('title').value = evt.titulo;
    $('tipo').value = evt.tipo;
    $('tipo').disabled = true; // o tipo não muda depois de criado
    $('local').value = evt.local.id;
    $('vagas').value = evt.vagasTotais;
    $('description').value = evt.descricao;

    $('sessions-list').innerHTML = '';
    evt.sessoes.forEach((s) => addSessionRow(s.inicio, s.duracaoMinutos));

    const idsProf = evt.ministrantes.filter((m) => !m.externo).map((m) => m.professorId);
    document.querySelectorAll('input[name="min-prof"]').forEach((c) => { c.checked = idsProf.includes(Number(c.value)) || (c.disabled && Number(c.value) === currentUser.id); });
    $('ministrantes-ext').value = evt.ministrantes.filter((m) => m.externo).map((m) => m.nome).join(', ');

    const d = evt.detalhes;
    if (evt.tipo === 'Minicurso') {
      $('mc-carga').value = d.cargaHoraria; $('mc-nivel').value = d.nivel;
      $('mc-freq').value = d.frequenciaMinima; $('mc-prereq').value = d.preRequisitos;
    } else if (evt.tipo === 'Palestra') {
      $('pa-publico').value = d.publicoAlvo; $('pa-link').value = d.linkTransmissao;
    } else {
      $('wk-equipe').value = d.vagasPorEquipe; $('wk-materiais').value = d.materiais; $('wk-entrega').value = d.entregaFinal;
    }

    $('rascunho').checked = evt.status === 'rascunho';
    $('event-form-title').textContent = `Editar evento: ${evt.titulo}`;
    $('btn-event-submit').textContent = isAdmin() ? 'Salvar alterações' : 'Salvar e reenviar para aprovação';
    $('btn-cancel-edit').hidden = false;
    syncTipoFieldsets();
    syncLocalCapacity();
    switchTab('register');
  }

  $('btn-cancel-edit').addEventListener('click', () => { resetEventForm(); switchTab('manage'); });

  ['title', 'vagas'].forEach((id) => $(id).addEventListener('input', () => { setFieldError(id, ''); setFieldError('event-form', ''); }));

  eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canManage()) return;
    ['title', 'local', 'vagas', 'sessions', 'event-form'].forEach((id) => setFieldError(id, ''));

    const titulo = $('title').value.trim();
    const tipo = $('tipo').value;
    const vagasTotais = parseInt($('vagas').value, 10);
    const localId = Number($('local').value);
    const local = locais.find((x) => x.id === localId);

    const sessoes = [...$('sessions-list').querySelectorAll('.session-row')].map((r) => ({
      inicio: r.querySelector('.session-inicio').value,
      duracaoMinutos: parseInt(r.querySelector('.session-duracao').value, 10)
    }));

    let primeiroInvalido = null;
    const falha = (id, msg) => { setFieldError(id, msg); primeiroInvalido = primeiroInvalido || id; };

    if (!REGEX_PALAVRA.test(titulo)) falha('title', 'Informe um título válido com pelo menos 3 caracteres.');
    if (!local) falha('local', 'Selecione um local.');
    if (isNaN(vagasTotais) || vagasTotais < 1 || vagasTotais > 500) falha('vagas', 'Informe uma quantidade de vagas entre 1 e 500.');
    else if (local && vagasTotais > local.capacidade) falha('vagas', `O local comporta no máximo ${local.capacidade} pessoas.`);
    if (sessoes.some((s) => !s.inicio || isNaN(s.duracaoMinutos) || s.duracaoMinutos < 15 || s.duracaoMinutos > 720)) {
      falha('sessions', 'Preencha data, horário e duração (15 a 720 min) de todas as sessões.');
    }

    const ministrantes = [...document.querySelectorAll('input[name="min-prof"]:checked')].map((c) => ({ professorId: Number(c.value) }));
    $('ministrantes-ext').value.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => ministrantes.push({ nomeExterno: n }));
    if (ministrantes.length === 0 && !isProfessor()) {
      setFieldError('event-form', 'Selecione ao menos um professor ou informe um ministrante externo.');
      primeiroInvalido = primeiroInvalido || 'ministrantes-ext';
    }

    let detalhes;
    if (tipo === 'Minicurso') {
      detalhes = { cargaHoraria: $('mc-carga').value, nivel: $('mc-nivel').value, frequenciaMinima: $('mc-freq').value, preRequisitos: $('mc-prereq').value.trim() };
      if (!detalhes.cargaHoraria || Number(detalhes.cargaHoraria) < 1) {
        setFieldError('event-form', 'Informe a carga horária do minicurso.');
        primeiroInvalido = primeiroInvalido || 'mc-carga';
      }
    } else if (tipo === 'Palestra') {
      detalhes = { publicoAlvo: $('pa-publico').value.trim(), linkTransmissao: $('pa-link').value.trim() };
    } else {
      detalhes = { materiais: $('wk-materiais').value.trim(), vagasPorEquipe: $('wk-equipe').value, entregaFinal: $('wk-entrega').value.trim() };
    }

    if (primeiroInvalido) {
      const alvo = $(primeiroInvalido) || $('sessions-list').querySelector('input');
      if (alvo) alvo.focus();
      return;
    }

    const corpo = {
      titulo, tipo, vagasTotais, localId, sessoes, ministrantes, detalhes,
      descricao: $('description').value.trim(),
      rascunho: isProfessor() && $('rascunho').checked
    };

    try {
      const url = editingEventId ? `/api/eventos/${editingEventId}` : '/api/eventos';
      const res = await ApiClient.request(url, { method: editingEventId ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
      resetEventForm();
      switchTab('manage');
      showToast(res.message);
    } catch (err) {
      setFieldError('event-form', err.message);
      showToast(err.message, 'warning');
    }
  });

  // =========================================================
  // USUÁRIOS (ADMIN)
  // =========================================================
  async function fetchUsers() {
    const filtro = $('users-filter').value;
    const lista = $('users-list');
    lista.innerHTML = '<p class="field-hint">Carregando usuários...</p>';
    try {
      const data = await ApiClient.request(`/api/usuarios${filtro === 'todos' ? '' : `?tipo=${filtro}`}`);
      const usuarios = data.usuarios || [];
      if (usuarios.length === 0) {
        lista.innerHTML = '<div class="empty-state"><p>Nenhum usuário nesta lista.</p></div>';
        return;
      }
      lista.innerHTML = usuarios.map((u) => {
        const detalhe = u.tipo === 'aluno'
          ? `Matrícula ${u.matricula} • ${u.curso}${u.periodo ? ` • ${u.periodo}º período` : ''} • ${u.total_inscricoes} inscrição(ões)`
          : `SIAPE ${u.siape} • ${u.departamento} • ${u.titulacao} • ${u.total_eventos} evento(s)`;
        const pendente = u.status === 'pendente';
        return `
          <article class="manage-item">
            <div class="manage-main">
              <div class="card-badges">
                <span class="badge-status ${u.tipo === 'professor' ? 'status-aprovado' : 'status-encerrado'}">${TIPO_USUARIO_LABEL[u.tipo]}</span>
                ${pendente ? '<span class="badge-status status-pendente">Aguardando aprovação</span>' : ''}
              </div>
              <h3>${escapeHTML(u.nome)}</h3>
              <p class="manage-meta">${escapeHTML(u.email)}</p>
              <p class="manage-meta">${escapeHTML(detalhe)}</p>
            </div>
            <div class="manage-actions">
              ${pendente ? `<button type="button" class="btn-mini btn-mini-reset" data-user-action="aprovar" data-id="${u.id}" data-nome="${escapeHTML(u.nome)}">Aprovar</button>` : ''}
              ${pendente ? '' : `<button type="button" class="btn-mini btn-mini-reset" data-user-action="senha" data-id="${u.id}" data-nome="${escapeHTML(u.nome)}">Nova senha</button>`}
              <button type="button" class="btn-mini btn-mini-del" data-user-action="excluir" data-id="${u.id}" data-nome="${escapeHTML(u.nome)}">${pendente ? 'Recusar' : 'Excluir'}</button>
            </div>
          </article>`;
      }).join('');
    } catch (err) {
      lista.innerHTML = `<p class="error-msg visible">${escapeHTML(err.message)}</p>`;
    }
  }

  $('users-filter').addEventListener('change', fetchUsers);

  $('users-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-user-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const nome = btn.dataset.nome;

    try {
      if (btn.dataset.userAction === 'aprovar') {
        const res = await ApiClient.request(`/api/usuarios/${id}/aprovar`, { method: 'PUT' });
        showToast(res.message);
      } else if (btn.dataset.userAction === 'senha') {
        const novaSenha = window.prompt(`Digite a nova senha (mínimo 6 caracteres) para ${nome}:`);
        if (!novaSenha) return;
        const res = await ApiClient.request(`/api/usuarios/${id}/password`, { method: 'PUT', body: JSON.stringify({ novaSenha }) });
        showToast(res.message);
        return;
      } else {
        const recusa = btn.textContent.trim() === 'Recusar';
        const ok = await askConfirm({
          title: recusa ? 'Recusar cadastro' : 'Excluir usuário',
          message: recusa ? `Recusar e remover o cadastro de "${nome}"?` : `Remover "${nome}" do sistema? As inscrições e vagas serão liberadas.`,
          confirmLabel: recusa ? 'Recusar' : 'Excluir'
        });
        if (!ok) return;
        const res = await ApiClient.request(`/api/usuarios/${id}`, { method: 'DELETE' });
        showToast(res.message, 'warning');
      }
      await fetchUsers();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  });

  // =========================================================
  // INICIALIZAÇÃO
  // =========================================================
  syncRegisterType();
  enterApplication();
});
