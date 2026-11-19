/* =========================================================
   IFEventos - Regras compartilhadas de eventos
   (carregamento, validação por tipo, conflito de local, lista de espera)
   ========================================================= */

const { dbRun, dbGet, dbAll } = require('../database/db');

const TIPOS = ['Minicurso', 'Palestra', 'Workshop'];
const NIVEIS = ['iniciante', 'intermediario', 'avancado'];
const FREQUENCIA_PADRAO = 75;
const REGEX_PALAVRA = /[a-zA-ZÀ-ÿ0-9]{3,}/;
const REGEX_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function fimDaSessao(inicio, duracaoMinutos) {
  return new Date(new Date(inicio).getTime() + duracaoMinutos * 60000);
}

function placeholders(arr) {
  return arr.map(() => '?').join(',');
}

// ---------------------------------------------------------
// CARREGAMENTO (núcleo + subtipo + ministrantes + sessões + situação do usuário)
// ---------------------------------------------------------
async function carregarEventos(user, { filtroSql = '1=1', params = [] } = {}) {
  const rows = await dbAll(
    `SELECT e.*, l.nome AS local_nome, l.capacidade AS local_capacidade,
            mc.carga_horaria, mc.nivel, mc.pre_requisitos, mc.frequencia_minima,
            pa.publico_alvo, pa.link_transmissao,
            wk.materiais_necessarios, wk.vagas_por_equipe, wk.entrega_final,
            (SELECT COUNT(*) FROM inscricoes i WHERE i.evento_id = e.id AND i.status = 'confirmada') AS inscritos,
            (SELECT COUNT(*) FROM inscricoes i WHERE i.evento_id = e.id AND i.status = 'lista_espera') AS espera
       FROM eventos e
       JOIN locais l ON l.id = e.local_id
       LEFT JOIN minicursos mc ON mc.evento_id = e.id
       LEFT JOIN palestras pa ON pa.evento_id = e.id
       LEFT JOIN workshops wk ON wk.evento_id = e.id
      WHERE ${filtroSql}
      ORDER BY e.data_hora ASC, e.id ASC`,
    params
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const ph = placeholders(ids);

  const [ministrantes, sessoes] = await Promise.all([
    dbAll(
      `SELECT em.evento_id, em.professor_id, COALESCE(u.nome, em.nome_externo) AS nome
         FROM evento_ministrantes em
         LEFT JOIN usuarios u ON u.id = em.professor_id
        WHERE em.evento_id IN (${ph}) ORDER BY em.id`,
      ids
    ),
    dbAll(
      `SELECT id, evento_id, inicio, duracao_minutos
         FROM evento_sessoes WHERE evento_id IN (${ph}) ORDER BY inicio, id`,
      ids
    )
  ]);

  let minhas = [];
  let presencas = [];
  let certs = [];
  if (user.tipo === 'aluno') {
    [minhas, presencas, certs] = await Promise.all([
      dbAll(`SELECT evento_id, status FROM inscricoes WHERE aluno_id = ? AND evento_id IN (${ph})`, [user.id, ...ids]),
      dbAll(
        `SELECT i.evento_id, COUNT(*) AS n
           FROM presencas p JOIN inscricoes i ON i.id = p.inscricao_id
          WHERE i.aluno_id = ? AND i.evento_id IN (${ph}) GROUP BY i.evento_id`,
        [user.id, ...ids]
      ),
      dbAll(
        `SELECT i.evento_id, c.codigo
           FROM certificados c JOIN inscricoes i ON i.id = c.inscricao_id
          WHERE i.aluno_id = ? AND i.evento_id IN (${ph})`,
        [user.id, ...ids]
      )
    ]);
  }

  const agora = new Date();

  return rows.map((r) => {
    const mins = ministrantes.filter((m) => m.evento_id === r.id)
      .map((m) => ({ nome: m.nome, professorId: m.professor_id, externo: m.professor_id == null }));
    const sess = sessoes.filter((s) => s.evento_id === r.id)
      .map((s) => ({ id: s.id, inicio: s.inicio, duracaoMinutos: s.duracao_minutos }));

    let detalhes = {};
    if (r.tipo === 'Minicurso') {
      detalhes = { cargaHoraria: r.carga_horaria, nivel: r.nivel, preRequisitos: r.pre_requisitos || '', frequenciaMinima: r.frequencia_minima };
    } else if (r.tipo === 'Palestra') {
      detalhes = { publicoAlvo: r.publico_alvo || '', linkTransmissao: r.link_transmissao || '' };
    } else {
      detalhes = { materiais: r.materiais_necessarios || '', vagasPorEquipe: r.vagas_por_equipe, entregaFinal: r.entrega_final || '' };
    }

    const minha = minhas.find((m) => m.evento_id === r.id);
    const statusInscricao = minha && minha.status !== 'cancelada' ? minha.status : null;
    const presentes = (presencas.find((p) => p.evento_id === r.id) || {}).n || 0;
    const cert = certs.find((c) => c.evento_id === r.id);

    const primeiraInicio = sess.length ? new Date(sess[0].inicio) : new Date(r.data_hora);
    const ultimaInicio = sess.length ? new Date(sess[sess.length - 1].inicio) : primeiraInicio;
    const percentual = sess.length ? Math.round((presentes / sess.length) * 100) : 0;
    const freqMin = r.tipo === 'Minicurso' ? r.frequencia_minima : FREQUENCIA_PADRAO;

    const elegivelCertificado = Boolean(
      user.tipo === 'aluno' && statusInscricao === 'confirmada' && !cert &&
      ['aprovado', 'encerrado'].includes(r.status) &&
      ultimaInicio <= agora && percentual >= freqMin
    );

    return {
      id: r.id,
      titulo: r.titulo,
      descricao: r.descricao || '',
      tipo: r.tipo,
      status: r.status,
      justificativaRejeicao: r.justificativa_rejeicao || '',
      dataHora: r.data_hora,
      local: { id: r.local_id, nome: r.local_nome, capacidade: r.local_capacidade },
      vagasTotais: r.vagas_totais,
      inscritos: r.inscritos,
      vagasLivres: Math.max(0, r.vagas_totais - r.inscritos),
      listaEspera: r.espera,
      ministrantes: mins,
      sessoes: sess,
      detalhes,
      criadoPor: r.criado_por,
      jaComecou: primeiraInicio <= agora,
      minhaInscricao: statusInscricao,
      minhaFrequencia: statusInscricao === 'confirmada'
        ? { presentes, total: sess.length, percentual, minimo: freqMin }
        : null,
      certificado: cert ? { codigo: cert.codigo } : null,
      elegivelCertificado,
      podeGerenciar: user.tipo === 'admin' || (user.tipo === 'professor' && r.criado_por === user.id)
    };
  });
}

async function carregarEvento(user, id) {
  const lista = await carregarEventos(user, { filtroSql: 'e.id = ?', params: [id] });
  return lista[0] || null;
}

// ---------------------------------------------------------
// VALIDAÇÃO DO PAYLOAD (núcleo + detalhes específicos do tipo)
// ---------------------------------------------------------
function texto(v) {
  return String(v == null ? '' : v).trim();
}

async function validarPayload(body, user, { tipoFixo = null, eventoIdAtual = null } = {}) {
  const titulo = texto(body.titulo);
  const descricao = texto(body.descricao);
  const tipo = tipoFixo || texto(body.tipo);
  const vagasTotais = parseInt(body.vagasTotais, 10);
  const localId = parseInt(body.localId, 10);

  if (!REGEX_PALAVRA.test(titulo)) return { erro: 'Informe um título válido com pelo menos 3 caracteres.' };
  if (titulo.length > 150) return { erro: 'O título deve ter no máximo 150 caracteres.' };
  if (descricao.length > 2000) return { erro: 'A descrição deve ter no máximo 2000 caracteres.' };
  if (!TIPOS.includes(tipo)) return { erro: 'Selecione um tipo de evento válido.' };
  if (isNaN(vagasTotais) || vagasTotais < 1 || vagasTotais > 500) {
    return { erro: 'A quantidade de vagas deve estar entre 1 e 500.' };
  }

  const local = isNaN(localId) ? null : await dbGet(`SELECT id, nome, capacidade FROM locais WHERE id = ?`, [localId]);
  if (!local) return { erro: 'Selecione um local válido.' };
  if (vagasTotais > local.capacidade) {
    return { erro: `O local "${local.nome}" comporta no máximo ${local.capacidade} pessoas.` };
  }

  // Sessões
  if (!Array.isArray(body.sessoes) || body.sessoes.length < 1 || body.sessoes.length > 30) {
    return { erro: 'Informe de 1 a 30 sessões (data, horário e duração).' };
  }
  const sessoes = [];
  for (const s of body.sessoes) {
    const inicio = texto(s && s.inicio);
    const duracao = parseInt(s && s.duracaoMinutos, 10);
    if (!REGEX_DATA.test(inicio) || isNaN(new Date(inicio).getTime())) {
      return { erro: 'Há uma sessão com data ou horário inválido.' };
    }
    if (isNaN(duracao) || duracao < 15 || duracao > 720) {
      return { erro: 'A duração de cada sessão deve ficar entre 15 e 720 minutos.' };
    }
    sessoes.push({ inicio, duracaoMinutos: duracao });
  }
  sessoes.sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (new Date(sessoes[0].inicio) <= new Date()) {
    return { erro: 'A primeira sessão deve acontecer em uma data futura.' };
  }
  for (let i = 1; i < sessoes.length; i++) {
    if (fimDaSessao(sessoes[i - 1].inicio, sessoes[i - 1].duracaoMinutos) > new Date(sessoes[i].inicio)) {
      return { erro: 'As sessões do evento não podem se sobrepor.' };
    }
  }

  // Ministrantes (professores cadastrados e/ou nomes externos)
  const bruto = Array.isArray(body.ministrantes) ? body.ministrantes : [];
  const ministrantes = [];
  const vistos = new Set();
  for (const m of bruto) {
    if (m && m.professorId != null) {
      const pid = parseInt(m.professorId, 10);
      const prof = await dbGet(
        `SELECT p.usuario_id FROM professores p JOIN usuarios u ON u.id = p.usuario_id
          WHERE p.usuario_id = ? AND u.status = 'ativo'`,
        [pid]
      );
      if (!prof) return { erro: 'Um dos professores ministrantes não foi encontrado ou não está ativo.' };
      if (!vistos.has(`p${pid}`)) { vistos.add(`p${pid}`); ministrantes.push({ professorId: pid }); }
    } else if (m && texto(m.nomeExterno)) {
      const nome = texto(m.nomeExterno);
      if (!REGEX_PALAVRA.test(nome) || nome.length > 120) return { erro: 'Nome de ministrante externo inválido.' };
      if (!vistos.has(`e${nome.toLowerCase()}`)) { vistos.add(`e${nome.toLowerCase()}`); ministrantes.push({ nomeExterno: nome }); }
    }
  }
  if (user.tipo === 'professor' && !vistos.has(`p${user.id}`)) {
    ministrantes.unshift({ professorId: user.id }); // o professor criador sempre consta como ministrante
  }
  if (ministrantes.length === 0) return { erro: 'Informe ao menos um ministrante.' };

  // Detalhes por tipo
  const d = body.detalhes || {};
  let detalhes;
  if (tipo === 'Minicurso') {
    const cargaHoraria = parseInt(d.cargaHoraria, 10);
    const frequenciaMinima = d.frequenciaMinima === '' || d.frequenciaMinima == null ? FREQUENCIA_PADRAO : parseInt(d.frequenciaMinima, 10);
    const nivel = texto(d.nivel) || 'iniciante';
    if (isNaN(cargaHoraria) || cargaHoraria < 1 || cargaHoraria > 200) return { erro: 'Carga horária do minicurso deve estar entre 1 e 200 horas.' };
    if (!NIVEIS.includes(nivel)) return { erro: 'Nível do minicurso inválido.' };
    if (isNaN(frequenciaMinima) || frequenciaMinima < 50 || frequenciaMinima > 100) return { erro: 'Frequência mínima deve estar entre 50% e 100%.' };
    detalhes = { cargaHoraria, nivel, frequenciaMinima, preRequisitos: texto(d.preRequisitos).slice(0, 500) };
  } else if (tipo === 'Palestra') {
    const link = texto(d.linkTransmissao);
    if (link && !/^https?:\/\/\S+$/i.test(link)) return { erro: 'O link de transmissão deve começar com http:// ou https://.' };
    detalhes = { publicoAlvo: texto(d.publicoAlvo).slice(0, 300), linkTransmissao: link };
  } else {
    const vagasPorEquipe = d.vagasPorEquipe === '' || d.vagasPorEquipe == null ? 1 : parseInt(d.vagasPorEquipe, 10);
    if (isNaN(vagasPorEquipe) || vagasPorEquipe < 1 || vagasPorEquipe > 10) return { erro: 'Pessoas por equipe deve estar entre 1 e 10.' };
    detalhes = { materiais: texto(d.materiais).slice(0, 500), vagasPorEquipe, entregaFinal: texto(d.entregaFinal).slice(0, 500) };
  }

  const conflito = await buscarConflitoDeLocal(localId, sessoes, eventoIdAtual);
  if (conflito) {
    return { erro: `Conflito de horário: "${local.nome}" já está reservado para "${conflito.titulo}" nesse período.`, conflito: true };
  }

  return { dados: { titulo, descricao, tipo, vagasTotais, localId, sessoes, ministrantes, detalhes } };
}

async function buscarConflitoDeLocal(localId, sessoes, ignorarEventoId) {
  const existentes = await dbAll(
    `SELECT e.id, e.titulo, s.inicio, s.duracao_minutos
       FROM evento_sessoes s JOIN eventos e ON e.id = s.evento_id
      WHERE e.local_id = ? AND e.status IN ('pendente', 'aprovado') AND e.id <> ?`,
    [localId, ignorarEventoId || 0]
  );
  for (const nova of sessoes) {
    const ini = new Date(nova.inicio);
    const fim = fimDaSessao(nova.inicio, nova.duracaoMinutos);
    for (const ex of existentes) {
      const exIni = new Date(ex.inicio);
      const exFim = fimDaSessao(ex.inicio, ex.duracao_minutos);
      if (ini < exFim && exIni < fim) return ex;
    }
  }
  return null;
}

// ---------------------------------------------------------
// GRAVAÇÃO (ministrantes, sessões e tabela do subtipo)
// ---------------------------------------------------------
async function gravarFilhos(eventoId, dados) {
  for (const m of dados.ministrantes) {
    if (m.professorId != null) {
      await dbRun(`INSERT INTO evento_ministrantes (evento_id, professor_id) VALUES (?, ?)`, [eventoId, m.professorId]);
    } else {
      await dbRun(`INSERT INTO evento_ministrantes (evento_id, nome_externo) VALUES (?, ?)`, [eventoId, m.nomeExterno]);
    }
  }
  for (const s of dados.sessoes) {
    await dbRun(
      `INSERT INTO evento_sessoes (evento_id, inicio, duracao_minutos) VALUES (?, ?, ?)`,
      [eventoId, s.inicio, s.duracaoMinutos]
    );
  }
  const d = dados.detalhes;
  if (dados.tipo === 'Minicurso') {
    await dbRun(
      `INSERT OR REPLACE INTO minicursos (evento_id, carga_horaria, nivel, pre_requisitos, frequencia_minima) VALUES (?, ?, ?, ?, ?)`,
      [eventoId, d.cargaHoraria, d.nivel, d.preRequisitos || null, d.frequenciaMinima]
    );
  } else if (dados.tipo === 'Palestra') {
    await dbRun(
      `INSERT OR REPLACE INTO palestras (evento_id, publico_alvo, link_transmissao) VALUES (?, ?, ?)`,
      [eventoId, d.publicoAlvo || null, d.linkTransmissao || null]
    );
  } else {
    await dbRun(
      `INSERT OR REPLACE INTO workshops (evento_id, materiais_necessarios, vagas_por_equipe, entrega_final) VALUES (?, ?, ?, ?)`,
      [eventoId, d.materiais || null, d.vagasPorEquipe, d.entregaFinal || null]
    );
  }
}

async function criarEvento(dados, status, criadoPor) {
  const r = await dbRun(
    `INSERT INTO eventos (titulo, descricao, tipo, data_hora, local_id, vagas_totais, status, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [dados.titulo, dados.descricao || null, dados.tipo, dados.sessoes[0].inicio, dados.localId, dados.vagasTotais, status, criadoPor]
  );
  try {
    await gravarFilhos(r.lastID, dados);
  } catch (e) {
    await dbRun(`DELETE FROM eventos WHERE id = ?`, [r.lastID]); // cascata limpa o que foi gravado
    throw e;
  }
  return r.lastID;
}

async function atualizarEvento(id, dados, novoStatus) {
  await dbRun(
    `UPDATE eventos SET titulo = ?, descricao = ?, data_hora = ?, local_id = ?, vagas_totais = ?,
            status = ?, justificativa_rejeicao = CASE WHEN ? = 'rejeitado' THEN justificativa_rejeicao ELSE NULL END
      WHERE id = ?`,
    [dados.titulo, dados.descricao || null, dados.sessoes[0].inicio, dados.localId, dados.vagasTotais, novoStatus, novoStatus, id]
  );
  await dbRun(`DELETE FROM evento_ministrantes WHERE evento_id = ?`, [id]);
  await dbRun(`DELETE FROM evento_sessoes WHERE evento_id = ?`, [id]);
  await gravarFilhos(id, dados);
}

// ---------------------------------------------------------
// LISTA DE ESPERA
// ---------------------------------------------------------
async function promoverListaEspera(eventoId) {
  const ev = await dbGet(`SELECT vagas_totais FROM eventos WHERE id = ?`, [eventoId]);
  if (!ev) return 0;
  const { n } = await dbGet(
    `SELECT COUNT(*) AS n FROM inscricoes WHERE evento_id = ? AND status = 'confirmada'`,
    [eventoId]
  );
  const livres = ev.vagas_totais - n;
  if (livres <= 0) return 0;
  const r = await dbRun(
    `UPDATE inscricoes SET status = 'confirmada'
      WHERE id IN (SELECT id FROM inscricoes
                    WHERE evento_id = ? AND status = 'lista_espera'
                    ORDER BY data_inscricao, id LIMIT ?)`,
    [eventoId, livres]
  );
  return r.changes;
}

async function promoverVariosEventos(eventoIds) {
  for (const id of eventoIds) await promoverListaEspera(id);
}

async function eventosConfirmadosDoAluno(alunoId) {
  const rows = await dbAll(
    `SELECT evento_id FROM inscricoes WHERE aluno_id = ? AND status = 'confirmada'`,
    [alunoId]
  );
  return rows.map((r) => r.evento_id);
}

module.exports = {
  TIPOS,
  FREQUENCIA_PADRAO,
  carregarEventos,
  carregarEvento,
  validarPayload,
  buscarConflitoDeLocal,
  criarEvento,
  atualizarEvento,
  promoverListaEspera,
  promoverVariosEventos,
  eventosConfirmadosDoAluno
};
