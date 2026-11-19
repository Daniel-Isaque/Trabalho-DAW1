/* =========================================================
   IFEventos - Eventos, locais, inscrições, presenças e certificados
   ========================================================= */

const crypto = require('crypto');
const express = require('express');

const { dbRun, dbGet, dbAll } = require('../database/db');
const { authenticateToken, requireTipo } = require('../middleware/auth');
const lib = require('../lib/eventos');

const router = express.Router();
router.use(authenticateToken);

const podeGerenciar = (user, ev) =>
  user.tipo === 'admin' || (user.tipo === 'professor' && ev.criado_por === user.id);

async function eventoBasico(id) {
  return dbGet(`SELECT id, titulo, tipo, status, criado_por, vagas_totais, data_hora FROM eventos WHERE id = ?`, [id]);
}

// =========================================================
// AUXILIARES: LOCAIS E PROFESSORES
// =========================================================
router.get('/locais', async (req, res) => {
  try {
    res.json({ locais: await dbAll(`SELECT id, nome, capacidade FROM locais ORDER BY nome`) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar locais.' });
  }
});

router.post('/locais', requireTipo('admin'), async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const capacidade = parseInt(req.body.capacidade, 10);
    if (nome.length < 3 || isNaN(capacidade) || capacidade < 1 || capacidade > 1000) {
      return res.status(400).json({ error: 'Informe um nome e uma capacidade entre 1 e 1000.' });
    }
    if (await dbGet(`SELECT id FROM locais WHERE nome = ?`, [nome])) {
      return res.status(409).json({ error: 'Já existe um local com esse nome.' });
    }
    const r = await dbRun(`INSERT INTO locais (nome, capacidade) VALUES (?, ?)`, [nome, capacidade]);
    res.status(201).json({ id: r.lastID, message: 'Local cadastrado.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cadastrar local.' });
  }
});

router.get('/professores', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const professores = await dbAll(
      `SELECT u.id, u.nome, p.departamento
         FROM professores p JOIN usuarios u ON u.id = p.usuario_id
        WHERE u.status = 'ativo' ORDER BY u.nome`
    );
    res.json({ professores });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar professores.' });
  }
});

// =========================================================
// LISTAGEM
//   ?escopo=catalogo  -> eventos aprovados (todos os usuários)
//   ?escopo=gerenciar -> professor: os seus; admin: todos
// =========================================================
router.get('/eventos', async (req, res) => {
  try {
    const { user } = req;
    let filtroSql = `e.status = 'aprovado'`;
    let params = [];

    if (user.tipo === 'aluno') {
      // O aluno também enxerga eventos encerrados em que participou (para emitir certificado).
      filtroSql = `(e.status = 'aprovado' OR (e.status = 'encerrado' AND EXISTS (
                      SELECT 1 FROM inscricoes i WHERE i.evento_id = e.id AND i.aluno_id = ? AND i.status = 'confirmada')))`;
      params = [user.id];
    }

    if (req.query.escopo === 'gerenciar') {
      if (!['professor', 'admin'].includes(user.tipo)) {
        return res.status(403).json({ error: 'Permissão negada para o seu tipo de conta.' });
      }
      if (user.tipo === 'professor') {
        filtroSql = 'e.criado_por = ?';
        params = [user.id];
      } else {
        filtroSql = '1 = 1';
      }
    }

    res.json({ eventos: await lib.carregarEventos(user, { filtroSql, params }) });
  } catch (err) {
    console.error('Erro ao buscar eventos:', err);
    res.status(500).json({ error: 'Erro ao carregar eventos do banco de dados.' });
  }
});

// =========================================================
// CRIAR / EDITAR
// =========================================================
router.post('/eventos', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const { user } = req;
    const v = await lib.validarPayload(req.body, user);
    if (v.erro) return res.status(v.conflito ? 409 : 400).json({ error: v.erro });

    // Admin publica direto; professor envia para aprovação (ou salva como rascunho).
    const status = user.tipo === 'admin' ? 'aprovado' : (req.body.rascunho ? 'rascunho' : 'pendente');
    const id = await lib.criarEvento(v.dados, status, user.id);

    const mensagem = status === 'aprovado' ? 'Evento publicado!'
      : status === 'rascunho' ? 'Rascunho salvo.'
      : 'Evento enviado para aprovação do administrador.';
    res.status(201).json({ id, status, message: mensagem });
  } catch (err) {
    console.error('Erro ao criar evento:', err);
    res.status(500).json({ error: 'Erro interno ao salvar evento.' });
  }
});

router.put('/eventos/:id', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const { user } = req;
    const id = Number(req.params.id);
    const ev = await eventoBasico(id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (!podeGerenciar(user, ev)) return res.status(403).json({ error: 'Você não pode editar este evento.' });

    const editavelProfessor = ['rascunho', 'pendente', 'rejeitado'].includes(ev.status);
    const editavelAdmin = ['rascunho', 'pendente', 'rejeitado', 'aprovado'].includes(ev.status);
    if (!(user.tipo === 'admin' ? editavelAdmin : editavelProfessor)) {
      return res.status(409).json({ error: 'Eventos aprovados só podem ser editados por um administrador.' });
    }

    const { n: comPresenca } = await dbGet(
      `SELECT COUNT(*) AS n FROM presencas p JOIN evento_sessoes s ON s.id = p.sessao_id WHERE s.evento_id = ?`, [id]
    );
    if (comPresenca > 0) {
      return res.status(409).json({ error: 'Este evento já tem presenças registradas e não pode mais ser editado.' });
    }

    const v = await lib.validarPayload(req.body, user, { tipoFixo: ev.tipo, eventoIdAtual: id });
    if (v.erro) return res.status(v.conflito ? 409 : 400).json({ error: v.erro });

    const { n: confirmados } = await dbGet(
      `SELECT COUNT(*) AS n FROM inscricoes WHERE evento_id = ? AND status = 'confirmada'`, [id]
    );
    if (v.dados.vagasTotais < confirmados) {
      return res.status(409).json({ error: `Já existem ${confirmados} inscrições confirmadas; as vagas não podem ficar abaixo disso.` });
    }

    // Professor que edita reenvia para aprovação; admin mantém o status.
    let novoStatus = ev.status;
    if (user.tipo === 'professor') novoStatus = req.body.rascunho ? 'rascunho' : 'pendente';

    await lib.atualizarEvento(id, v.dados, novoStatus);
    await lib.promoverListaEspera(id);
    res.json({ status: novoStatus, message: novoStatus === 'pendente' ? 'Evento atualizado e reenviado para aprovação.' : 'Evento atualizado.' });
  } catch (err) {
    console.error('Erro ao editar evento:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar evento.' });
  }
});

// =========================================================
// FLUXO DE STATUS: enviar | aprovar | rejeitar | cancelar | encerrar
// =========================================================
const ACOES = {
  enviar:   { de: ['rascunho', 'rejeitado'], para: 'pendente',  quem: 'dono' },
  aprovar:  { de: ['pendente'],              para: 'aprovado',  quem: 'admin' },
  rejeitar: { de: ['pendente'],              para: 'rejeitado', quem: 'admin' },
  cancelar: { de: ['rascunho', 'pendente', 'aprovado'], para: 'cancelado', quem: 'dono' },
  encerrar: { de: ['aprovado'],              para: 'encerrado', quem: 'dono' }
};

router.put('/eventos/:id/acao', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const { user } = req;
    const id = Number(req.params.id);
    const acao = ACOES[String(req.body.acao || '')];
    if (!acao) return res.status(400).json({ error: 'Ação inválida.' });

    const ev = await eventoBasico(id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

    if (acao.quem === 'admin' ? user.tipo !== 'admin' : !podeGerenciar(user, ev)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    if (!acao.de.includes(ev.status)) {
      return res.status(409).json({ error: `Esta ação não é possível para um evento ${ev.status}.` });
    }

    let justificativa = null;
    if (acao.para === 'rejeitado') {
      justificativa = String(req.body.justificativa || '').trim();
      if (justificativa.length < 5) return res.status(400).json({ error: 'Informe uma justificativa para a rejeição (mínimo 5 caracteres).' });
      if (justificativa.length > 500) return res.status(400).json({ error: 'A justificativa deve ter no máximo 500 caracteres.' });
    }

    if (acao.para === 'aprovado' || acao.para === 'pendente') {
      // Revalida conflito de local na hora de aprovar/enviar (outro evento pode ter entrado antes).
      const ocupado = await dbGet(`SELECT local_id FROM eventos WHERE id = ?`, [id]);
      const sessoes = await dbAll(`SELECT inicio, duracao_minutos AS duracaoMinutos FROM evento_sessoes WHERE evento_id = ?`, [id]);
      // (a validação usa o mesmo formato {inicio, duracaoMinutos} do payload)
      const conflito = await lib.buscarConflitoDeLocal(ocupado.local_id, sessoes, id);
      if (conflito) {
        return res.status(409).json({ error: `Conflito de horário com "${conflito.titulo}" no mesmo local.` });
      }
    }

    await dbRun(
      `UPDATE eventos SET status = ?, justificativa_rejeicao = ? WHERE id = ?`,
      [acao.para, justificativa, id]
    );

    const mensagens = {
      enviar: 'Evento enviado para aprovação.',
      aprovar: 'Evento aprovado e publicado no catálogo.',
      rejeitar: 'Evento rejeitado. O professor verá a justificativa.',
      cancelar: 'Evento cancelado.',
      encerrar: 'Evento encerrado.'
    };
    res.json({ status: acao.para, message: mensagens[req.body.acao] });
  } catch (err) {
    console.error('Erro na ação do evento:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar o status do evento.' });
  }
});

router.delete('/eventos/:id', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const { user } = req;
    const id = Number(req.params.id);
    const ev = await eventoBasico(id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (!podeGerenciar(user, ev)) return res.status(403).json({ error: 'Você não pode excluir este evento.' });
    if (user.tipo === 'professor' && !['rascunho', 'pendente', 'rejeitado', 'cancelado'].includes(ev.status)) {
      return res.status(409).json({ error: 'Eventos aprovados ou encerrados só podem ser removidos por um administrador (ou cancelados por você).' });
    }
    await dbRun(`DELETE FROM eventos WHERE id = ?`, [id]);
    res.json({ message: 'Evento removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao excluir evento:', err);
    res.status(500).json({ error: 'Erro interno ao excluir evento.' });
  }
});

// =========================================================
// INSCRIÇÃO DO ALUNO (alterna inscrever / cancelar; com lista de espera)
// =========================================================
router.post('/eventos/:id/inscricao', requireTipo('aluno'), async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const userId = req.user.id;
    const ev = await eventoBasico(eventId);
    if (!ev || ev.status !== 'aprovado') {
      return res.status(404).json({ error: 'Evento não encontrado ou indisponível para inscrição.' });
    }
    if (new Date(ev.data_hora) <= new Date()) {
      return res.status(409).json({ error: 'As inscrições deste evento já foram encerradas (o evento já começou).' });
    }

    const atual = await dbGet(`SELECT id, status FROM inscricoes WHERE aluno_id = ? AND evento_id = ?`, [userId, eventId]);

    if (atual && ['confirmada', 'lista_espera'].includes(atual.status)) {
      await dbRun(`UPDATE inscricoes SET status = 'cancelada' WHERE id = ?`, [atual.id]);
      await dbRun(`DELETE FROM presencas WHERE inscricao_id = ?`, [atual.id]);
      if (atual.status === 'confirmada') await lib.promoverListaEspera(eventId);
      return res.json({ subscribed: false, status: null, message: `Inscrição cancelada em "${ev.titulo}".` });
    }

    // Status decidido dentro do próprio INSERT para não estourar as vagas em requisições simultâneas.
    await dbRun(
      `INSERT INTO inscricoes (aluno_id, evento_id, status)
       VALUES (?, ?, CASE WHEN (SELECT COUNT(*) FROM inscricoes WHERE evento_id = ? AND status = 'confirmada')
                               < (SELECT vagas_totais FROM eventos WHERE id = ?)
                          THEN 'confirmada' ELSE 'lista_espera' END)
       ON CONFLICT(aluno_id, evento_id) DO UPDATE SET
         status = excluded.status,
         data_inscricao = strftime('%Y-%m-%d %H:%M:%f', 'now')`,
      [userId, eventId, eventId, eventId]
    );
    const nova = await dbGet(`SELECT status FROM inscricoes WHERE aluno_id = ? AND evento_id = ?`, [userId, eventId]);

    if (nova.status === 'lista_espera') {
      return res.status(201).json({
        subscribed: true, status: 'lista_espera',
        message: `Vagas esgotadas: você entrou na lista de espera de "${ev.titulo}".`
      });
    }
    res.status(201).json({ subscribed: true, status: 'confirmada', message: `Presença confirmada em "${ev.titulo}"!` });
  } catch (err) {
    console.error('Erro ao alternar inscrição:', err);
    res.status(500).json({ error: 'Erro interno ao processar inscrição.' });
  }
});

// =========================================================
// INSCRITOS E PRESENÇAS (professor dono ou admin)
// =========================================================
router.get('/eventos/:id/inscritos', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ev = await eventoBasico(id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (!podeGerenciar(req.user, ev)) return res.status(403).json({ error: 'Você não pode ver os inscritos deste evento.' });

    const [sessoes, inscritos, presencas] = await Promise.all([
      dbAll(`SELECT id, inicio, duracao_minutos AS duracaoMinutos FROM evento_sessoes WHERE evento_id = ? ORDER BY inicio, id`, [id]),
      dbAll(
        `SELECT i.id AS inscricaoId, i.status, i.data_inscricao AS dataInscricao,
                u.nome, u.email, a.matricula, a.curso, c.codigo AS certificado
           FROM inscricoes i
           JOIN usuarios u ON u.id = i.aluno_id
           JOIN alunos a ON a.usuario_id = i.aluno_id
           LEFT JOIN certificados c ON c.inscricao_id = i.id
          WHERE i.evento_id = ? AND i.status IN ('confirmada', 'lista_espera')
          ORDER BY (i.status = 'confirmada') DESC, i.data_inscricao, i.id`,
        [id]
      ),
      dbAll(
        `SELECT p.inscricao_id, p.sessao_id FROM presencas p
           JOIN inscricoes i ON i.id = p.inscricao_id WHERE i.evento_id = ?`,
        [id]
      )
    ]);

    res.json({
      evento: { id: ev.id, titulo: ev.titulo, status: ev.status, vagasTotais: ev.vagas_totais },
      sessoes,
      inscritos: inscritos.map((i) => ({
        ...i,
        presencas: presencas.filter((p) => p.inscricao_id === i.inscricaoId).map((p) => p.sessao_id)
      }))
    });
  } catch (err) {
    console.error('Erro ao listar inscritos:', err);
    res.status(500).json({ error: 'Erro ao listar inscritos.' });
  }
});

router.put('/eventos/:id/presenca', requireTipo('professor', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inscricaoId = Number(req.body.inscricaoId);
    const sessaoId = Number(req.body.sessaoId);
    const presente = Boolean(req.body.presente);

    const ev = await eventoBasico(id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (!podeGerenciar(req.user, ev)) return res.status(403).json({ error: 'Você não pode registrar presença neste evento.' });
    if (!['aprovado', 'encerrado'].includes(ev.status)) {
      return res.status(409).json({ error: 'Só é possível registrar presença em eventos aprovados ou encerrados.' });
    }

    const insc = await dbGet(`SELECT id, status FROM inscricoes WHERE id = ? AND evento_id = ?`, [inscricaoId, id]);
    const sessao = await dbGet(`SELECT id, inicio FROM evento_sessoes WHERE id = ? AND evento_id = ?`, [sessaoId, id]);
    if (!insc || insc.status !== 'confirmada') return res.status(404).json({ error: 'Inscrição confirmada não encontrada.' });
    if (!sessao) return res.status(404).json({ error: 'Sessão não encontrada.' });
    if (new Date(sessao.inicio) > new Date()) {
      return res.status(409).json({ error: 'Essa sessão ainda não começou.' });
    }

    if (presente) {
      await dbRun(`INSERT OR IGNORE INTO presencas (inscricao_id, sessao_id) VALUES (?, ?)`, [inscricaoId, sessaoId]);
    } else {
      await dbRun(`DELETE FROM presencas WHERE inscricao_id = ? AND sessao_id = ?`, [inscricaoId, sessaoId]);
    }
    res.json({ message: presente ? 'Presença registrada.' : 'Presença removida.' });
  } catch (err) {
    console.error('Erro ao registrar presença:', err);
    res.status(500).json({ error: 'Erro ao registrar presença.' });
  }
});

// =========================================================
// CERTIFICADO (emitido pelo próprio aluno quando cumpre a frequência)
// =========================================================
router.post('/eventos/:id/certificado', requireTipo('aluno'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const evento = await lib.carregarEvento(req.user, id);
    if (!evento || !evento.minhaInscricao) {
      return res.status(404).json({ error: 'Você não possui inscrição confirmada neste evento.' });
    }
    if (evento.certificado) {
      return res.json({ certificado: await buscarCertificado(evento.certificado.codigo) });
    }
    if (!evento.elegivelCertificado) {
      return res.status(409).json({ error: 'Certificado indisponível: é preciso concluir o evento com a frequência mínima exigida.' });
    }

    const minutos = evento.tipo === 'Minicurso'
      ? evento.detalhes.cargaHoraria * 60
      : evento.sessoes.reduce((acc, s) => acc + s.duracaoMinutos, 0);
    const insc = await dbGet(`SELECT id FROM inscricoes WHERE aluno_id = ? AND evento_id = ?`, [req.user.id, id]);
    const codigo = 'IFEV-' + crypto.randomBytes(5).toString('hex').toUpperCase();

    await dbRun(
      `INSERT INTO certificados (inscricao_id, codigo, carga_horaria_minutos) VALUES (?, ?, ?)`,
      [insc.id, codigo, minutos]
    );
    res.status(201).json({ certificado: await buscarCertificado(codigo), message: 'Certificado emitido!' });
  } catch (err) {
    console.error('Erro ao emitir certificado:', err);
    res.status(500).json({ error: 'Erro ao emitir certificado.' });
  }
});

async function buscarCertificado(codigo) {
  const c = await dbGet(
    `SELECT c.codigo, c.carga_horaria_minutos AS cargaHorariaMinutos, c.emitido_em AS emitidoEm,
            e.titulo, e.tipo, e.data_hora AS dataHora, l.nome AS local,
            u.nome AS aluno, a.matricula
       FROM certificados c
       JOIN inscricoes i ON i.id = c.inscricao_id
       JOIN eventos e ON e.id = i.evento_id
       JOIN locais l ON l.id = e.local_id
       JOIN usuarios u ON u.id = i.aluno_id
       JOIN alunos a ON a.usuario_id = i.aluno_id
      WHERE c.codigo = ?`,
    [codigo]
  );
  return c || null;
}

router.get('/certificados/meus', requireTipo('aluno'), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT c.codigo FROM certificados c JOIN inscricoes i ON i.id = c.inscricao_id
        WHERE i.aluno_id = ? ORDER BY c.emitido_em DESC, c.id DESC`,
      [req.user.id]
    );
    const certificados = [];
    for (const r of rows) certificados.push(await buscarCertificado(r.codigo));
    res.json({ certificados });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar certificados.' });
  }
});

module.exports = router;
module.exports.buscarCertificado = buscarCertificado;
