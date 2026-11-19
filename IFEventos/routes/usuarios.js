/* =========================================================
   IFEventos - Gestão de usuários (somente administrador)
   ========================================================= */

const express = require('express');
const bcrypt = require('bcryptjs');

const { dbRun, dbGet, dbAll } = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { promoverVariosEventos, eventosConfirmadosDoAluno } = require('../lib/eventos');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

// Lista alunos e professores (com dados das tabelas filhas). ?tipo=aluno|professor|pendentes
router.get('/', async (req, res) => {
  try {
    const filtros = [`u.tipo <> 'admin'`];
    if (req.query.tipo === 'aluno' || req.query.tipo === 'professor') {
      filtros.push(`u.tipo = '${req.query.tipo}'`);
    } else if (req.query.tipo === 'pendentes') {
      filtros.push(`u.status = 'pendente'`);
    }

    const usuarios = await dbAll(
      `SELECT u.id, u.nome, u.email, u.tipo, u.status, u.criado_em,
              a.matricula, a.curso, a.periodo,
              p.siape, p.departamento, p.titulacao,
              (SELECT COUNT(*) FROM inscricoes i WHERE i.aluno_id = u.id AND i.status <> 'cancelada') AS total_inscricoes,
              (SELECT COUNT(*) FROM eventos e WHERE e.criado_por = u.id) AS total_eventos
         FROM usuarios u
         LEFT JOIN alunos a ON a.usuario_id = u.id
         LEFT JOIN professores p ON p.usuario_id = u.id
        WHERE ${filtros.join(' AND ')}
        ORDER BY (u.status = 'pendente') DESC, u.tipo, u.nome`
    );
    res.json({ usuarios });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// Aprova o cadastro de um professor pendente
router.put('/:id/aprovar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const alvo = await dbGet(`SELECT id, tipo, status FROM usuarios WHERE id = ?`, [id]);
    if (!alvo || alvo.tipo !== 'professor') return res.status(404).json({ error: 'Professor não encontrado.' });
    if (alvo.status !== 'pendente') return res.status(409).json({ error: 'Este cadastro não está pendente.' });

    await dbRun(`UPDATE usuarios SET status = 'ativo' WHERE id = ?`, [id]);
    res.json({ message: 'Cadastro do professor aprovado. Ele já pode entrar no sistema.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao aprovar cadastro.' });
  }
});

router.put('/:id/password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const novaSenha = String(req.body.novaSenha || '');
    if (novaSenha.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
    }
    const alvo = await dbGet(`SELECT id, tipo FROM usuarios WHERE id = ?`, [id]);
    if (!alvo || alvo.tipo === 'admin') return res.status(404).json({ error: 'Usuário não encontrado.' });

    await dbRun(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, [await bcrypt.hash(novaSenha, 10), id]);
    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

// Remove aluno ou professor (também serve para recusar um cadastro pendente)
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const alvo = await dbGet(`SELECT id, tipo, status FROM usuarios WHERE id = ?`, [id]);
    if (!alvo || alvo.tipo === 'admin') return res.status(404).json({ error: 'Usuário não encontrado.' });

    const afetados = alvo.tipo === 'aluno' ? await eventosConfirmadosDoAluno(id) : [];
    await dbRun(`DELETE FROM usuarios WHERE id = ?`, [id]);
    await promoverVariosEventos(afetados);

    const msg = alvo.status === 'pendente' ? 'Cadastro recusado e removido.' : 'Usuário removido e vagas liberadas.';
    res.json({ message: msg });
  } catch (err) {
    console.error('Erro ao remover usuário:', err);
    res.status(500).json({ error: 'Erro ao remover usuário.' });
  }
});

module.exports = router;
