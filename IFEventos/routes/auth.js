/* =========================================================
   IFEventos - Autenticação e conta do usuário (pai + filhas)
   ========================================================= */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { dbRun, dbGet } = require('../database/db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const router = express.Router();

const DOMINIO_ALUNO = /^[a-zA-Z0-9._-]+@academico\.ifpb\.edu\.br$/i;
const DOMINIO_SERVIDOR = /^[a-zA-Z0-9._-]+@ifpb\.edu\.br$/i;
const TITULACOES = ['Graduação', 'Especialização', 'Mestrado', 'Doutorado'];

function gerarToken(user) {
  return jwt.sign(
    { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function usuarioPublico(u) {
  return { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo };
}

async function carregarPerfilCompleto(id) {
  return dbGet(
    `SELECT u.id, u.nome, u.email, u.tipo, u.status, u.criado_em,
            a.matricula, a.curso, a.periodo,
            p.siape, p.departamento, p.titulacao
       FROM usuarios u
       LEFT JOIN alunos a ON a.usuario_id = u.id
       LEFT JOIN professores p ON p.usuario_id = u.id
      WHERE u.id = ?`,
    [id]
  );
}

// 1. CADASTRO (aluno entra direto; professor fica pendente até o admin aprovar)
router.post('/register', async (req, res) => {
  try {
    const tipo = req.body.tipo === 'professor' ? 'professor' : 'aluno';
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    if (!/[a-zA-ZÀ-ÿ]{3,}/.test(nome)) {
      return res.status(400).json({ error: 'Informe um Nome ou Nome Social válido (mínimo 3 letras).' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    let dadosFilha;
    if (tipo === 'aluno') {
      if (!DOMINIO_ALUNO.test(email)) {
        return res.status(400).json({ error: 'Alunos devem usar o e-mail institucional @academico.ifpb.edu.br.' });
      }
      const matricula = String(req.body.matricula || '').trim();
      const curso = String(req.body.curso || '').trim();
      const periodo = req.body.periodo === '' || req.body.periodo == null ? null : parseInt(req.body.periodo, 10);
      if (!/^\d{6,14}$/.test(matricula)) {
        return res.status(400).json({ error: 'Informe a matrícula (somente números, de 6 a 14 dígitos).' });
      }
      if (curso.length < 3) {
        return res.status(400).json({ error: 'Informe o curso.' });
      }
      if (periodo !== null && (isNaN(periodo) || periodo < 1 || periodo > 12)) {
        return res.status(400).json({ error: 'O período deve estar entre 1 e 12.' });
      }
      if (await dbGet(`SELECT usuario_id FROM alunos WHERE matricula = ?`, [matricula])) {
        return res.status(409).json({ error: 'Esta matrícula já está cadastrada.' });
      }
      dadosFilha = { sql: `INSERT INTO alunos (usuario_id, matricula, curso, periodo) VALUES (?, ?, ?, ?)`, params: [matricula, curso, periodo] };
    } else {
      if (!DOMINIO_SERVIDOR.test(email)) {
        return res.status(400).json({ error: 'Professores devem usar o e-mail institucional @ifpb.edu.br.' });
      }
      const siape = String(req.body.siape || '').trim();
      const departamento = String(req.body.departamento || '').trim();
      const titulacao = String(req.body.titulacao || '').trim();
      if (!/^\d{5,10}$/.test(siape)) {
        return res.status(400).json({ error: 'Informe o SIAPE (somente números, de 5 a 10 dígitos).' });
      }
      if (departamento.length < 3) {
        return res.status(400).json({ error: 'Informe o departamento ou coordenação.' });
      }
      if (!TITULACOES.includes(titulacao)) {
        return res.status(400).json({ error: 'Selecione a titulação.' });
      }
      if (await dbGet(`SELECT usuario_id FROM professores WHERE siape = ?`, [siape])) {
        return res.status(409).json({ error: 'Este SIAPE já está cadastrado.' });
      }
      dadosFilha = { sql: `INSERT INTO professores (usuario_id, siape, departamento, titulacao) VALUES (?, ?, ?, ?)`, params: [siape, departamento, titulacao] };
    }

    if (await dbGet(`SELECT id FROM usuarios WHERE email = ?`, [email])) {
      return res.status(409).json({ error: 'Este e-mail já possui cadastro no sistema. Faça login para continuar.' });
    }

    const status = tipo === 'professor' ? 'pendente' : 'ativo';
    const senhaHash = await bcrypt.hash(senha, 10);
    const pai = await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, status) VALUES (?, ?, ?, ?, ?)`,
      [nome, email, senhaHash, tipo, status]
    );

    try {
      await dbRun(dadosFilha.sql, [pai.lastID, ...dadosFilha.params]);
    } catch (e) {
      await dbRun(`DELETE FROM usuarios WHERE id = ?`, [pai.lastID]); // desfaz o pai órfão
      throw e;
    }

    if (tipo === 'professor') {
      return res.status(202).json({
        pendente: true,
        message: 'Cadastro enviado! Um administrador precisa aprovar sua conta de professor antes do primeiro acesso.'
      });
    }

    const user = { id: pai.lastID, nome, email, tipo };
    return res.status(201).json({ message: 'Cadastro realizado com sucesso!', token: gerarToken(user), user });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'E-mail, matrícula ou SIAPE já cadastrado.' });
    }
    console.error('Erro no cadastro:', err);
    return res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

// 2. LOGIN ÚNICO (aluno, professor e admin)
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    if (!email || !senha) {
      return res.status(400).json({ error: 'Preencha seu e-mail institucional e sua senha.' });
    }

    const user = await dbGet(
      `SELECT id, nome, email, senha_hash, tipo, status FROM usuarios WHERE email = ?`,
      [email]
    );
    if (!user) {
      return res.status(401).json({ error: 'E-mail não encontrado. Clique em "Criar conta" abaixo.' });
    }
    if (!(await bcrypt.compare(senha, user.senha_hash))) {
      return res.status(401).json({ error: 'Senha incorreta. Tente novamente.' });
    }
    if (user.status === 'pendente') {
      return res.status(403).json({ error: 'Seu cadastro ainda aguarda aprovação de um administrador.' });
    }
    if (user.status === 'inativo') {
      return res.status(403).json({ error: 'Esta conta está desativada. Procure a coordenação.' });
    }

    const publico = usuarioPublico(user);
    return res.json({ message: 'Login realizado com sucesso!', token: gerarToken(publico), user: publico });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
});

// 3. PERFIL DO USUÁRIO LOGADO (pai + dados da filha)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await carregarPerfilCompleto(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar perfil.' });
  }
});

// 4. TROCAR A PRÓPRIA SENHA
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const senhaAtual = String(req.body.senhaAtual || '');
    const novaSenha = String(req.body.novaSenha || '');

    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
    }
    const minLen = req.user.tipo === 'admin' ? 4 : 6;
    if (novaSenha.length < minLen) {
      return res.status(400).json({ error: `A nova senha deve ter pelo menos ${minLen} caracteres.` });
    }

    const user = await dbGet(`SELECT senha_hash FROM usuarios WHERE id = ?`, [req.user.id]);
    if (!user || !(await bcrypt.compare(senhaAtual, user.senha_hash))) {
      return res.status(401).json({ error: 'A senha atual informada está incorreta.' });
    }

    await dbRun(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, [await bcrypt.hash(novaSenha, 10), req.user.id]);
    return res.json({ message: 'Senha atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar senha:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar senha.' });
  }
});

// 5. EXCLUIR A PRÓPRIA CONTA (a filha sai por cascata)
router.delete('/me', authenticateToken, async (req, res) => {
  try {
    if (req.user.tipo === 'admin') {
      return res.status(400).json({ error: 'A conta de administrador não pode ser excluída.' });
    }
    const { promoverVariosEventos, eventosConfirmadosDoAluno } = require('../lib/eventos');
    const afetados = req.user.tipo === 'aluno' ? await eventosConfirmadosDoAluno(req.user.id) : [];

    await dbRun(`DELETE FROM usuarios WHERE id = ?`, [req.user.id]);
    await promoverVariosEventos(afetados);
    return res.json({ message: 'Conta removida com sucesso e vagas liberadas.' });
  } catch (err) {
    console.error('Erro ao excluir própria conta:', err);
    return res.status(500).json({ error: 'Erro ao excluir conta.' });
  }
});

module.exports = router;
