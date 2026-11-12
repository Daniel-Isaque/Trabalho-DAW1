/* =========================================================
   IFEventos - Servidor API REST (Node.js + Express + SQLite)
   ========================================================= */

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { dbRun, dbGet, dbAll, initDatabase } = require('./database/db');
const { JWT_SECRET, authenticateToken, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const ACADEMIC_DOMAIN = '@academico.ifpb.edu.br';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// =========================================================
// ROTAS DE AUTENTICAÇÃO E CRUD DE USUÁRIO / SENHA
// =========================================================

// 1. CREATE: Cadastro Único de Aluno
app.post('/api/auth/register', async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    const regexNome = /[a-zA-ZÀ-ÿ]{3,}/;
    const regexEmailAcademico = /^[a-zA-Z0-9._-]+@academico\.ifpb\.edu\.br$/i;

    if (!nome || !regexNome.test(nome)) {
      return res.status(400).json({ error: 'Informe um Nome ou Nome Social válido (mínimo 3 letras).' });
    }

    if (!email || !email.endsWith(ACADEMIC_DOMAIN) || !regexEmailAcademico.test(email)) {
      return res.status(400).json({ error: 'É obrigatório utilizar um e-mail institucional @academico.ifpb.edu.br.' });
    }

    if (senha.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    const existingUser = await dbGet(`SELECT id FROM usuarios WHERE email = ?`, [email]);
    if (existingUser) {
      return res.status(409).json({
        error: 'Este e-mail acadêmico já possui cadastro no sistema. Faça login para continuar.'
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, 'aluno')`,
      [nome, email, senhaHash]
    );

    const newUser = {
      id: result.lastID,
      nome,
      email,
      perfil: 'aluno'
    };

    const token = generateToken(newUser);
    return res.status(201).json({
      message: 'Cadastro realizado com sucesso!',
      token,
      user: newUser
    });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Este e-mail acadêmico já está cadastrado.' });
    }
    console.error('Erro no cadastro:', err);
    return res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

// 2. LOGIN DO ALUNO (E-mail + Senha)
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    if (!email || !senha) {
      return res.status(400).json({ error: 'Preencha seu e-mail acadêmico e sua senha.' });
    }

    const user = await dbGet(
      `SELECT id, nome, email, senha_hash, perfil FROM usuarios WHERE email = ? AND perfil = 'aluno'`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'E-mail não encontrado. Clique em "Criar conta acadêmica" abaixo.' });
    }

    const validPassword = await bcrypt.compare(senha, user.senha_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Senha incorreta. Tente novamente.' });
    }

    const userPayload = {
      id: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil
    };

    return res.json({
      message: 'Login realizado com sucesso!',
      token: generateToken(userPayload),
      user: userPayload
    });
  } catch (err) {
    console.error('Erro no login de aluno:', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
});

// 3. LOGIN DO ADMINISTRADOR
app.post('/api/auth/login-admin', async (req, res) => {
  try {
    const senha = String(req.body.senha || '');
    if (!senha) {
      return res.status(400).json({ error: 'Digite a senha de administrador.' });
    }

    const adminUser = await dbGet(
      `SELECT id, nome, email, senha_hash, perfil FROM usuarios WHERE perfil = 'admin' LIMIT 1`
    );

    if (!adminUser) {
      return res.status(500).json({ error: 'Conta administrativa não configurada no banco.' });
    }

    const validPassword = await bcrypt.compare(senha, adminUser.senha_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Senha de administrador incorreta.' });
    }

    const userPayload = {
      id: adminUser.id,
      nome: adminUser.nome,
      email: adminUser.email,
      perfil: adminUser.perfil
    };

    return res.json({
      message: 'Acesso de Administrador liberado!',
      token: generateToken(userPayload),
      user: userPayload
    });
  } catch (err) {
    console.error('Erro no login admin:', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar administrador.' });
  }
});

// 4. READ: Consultar dados do usuário autenticado
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await dbGet(
      `SELECT id, nome, email, perfil, criado_em FROM usuarios WHERE id = ?`,
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar perfil.' });
  }
});

// 5. UPDATE: Atualizar / Trocar a própria senha
app.put('/api/auth/password', authenticateToken, async (req, res) => {
  try {
    const senhaAtual = String(req.body.senhaAtual || '');
    const novaSenha = String(req.body.novaSenha || '');

    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
    }

    const minLen = req.user.perfil === 'admin' ? 4 : 6;
    if (novaSenha.length < minLen) {
      return res.status(400).json({ error: `A nova senha deve ter pelo menos ${minLen} caracteres.` });
    }

    const user = await dbGet(`SELECT id, senha_hash FROM usuarios WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const isMatch = await bcrypt.compare(senhaAtual, user.senha_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'A senha atual informada está incorreta.' });
    }

    const novoHash = await bcrypt.hash(novaSenha, 10);
    await dbRun(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, [novoHash, req.user.id]);

    return res.json({ message: 'Senha atualizada com sucesso no banco de dados!' });
  } catch (err) {
    console.error('Erro ao atualizar senha:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar senha.' });
  }
});

// 6. DELETE: Excluir a própria conta (Aluno)
app.delete('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    if (req.user.perfil === 'admin') {
      return res.status(400).json({ error: 'A conta principal de administrador não pode ser excluída.' });
    }

    await dbRun(`DELETE FROM usuarios WHERE id = ?`, [req.user.id]);
    return res.json({ message: 'Conta removida com sucesso e vagas liberadas.' });
  } catch (err) {
    console.error('Erro ao excluir própria conta:', err);
    return res.status(500).json({ error: 'Erro ao excluir conta.' });
  }
});

// =========================================================
// ROTAS ADMINISTRATIVAS DE USUÁRIOS (CRUD COMPLETO PARA ADMIN)
// =========================================================

app.get('/api/usuarios', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuarios = await dbAll(
      `SELECT u.id, u.nome, u.email, u.perfil, u.criado_em,
              COUNT(i.id) AS total_inscricoes
       FROM usuarios u
       LEFT JOIN inscricoes i ON i.usuario_id = u.id
       WHERE u.perfil = 'aluno'
       GROUP BY u.id
       ORDER BY u.criado_em DESC`
    );
    return res.json({ usuarios });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao listar alunos cadastrados.' });
  }
});

app.put('/api/usuarios/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const novaSenha = String(req.body.novaSenha || '');

    if (novaSenha.length < 6) {
      return res.status(400).json({ error: 'A nova senha do aluno deve ter pelo menos 6 caracteres.' });
    }

    const target = await dbGet(`SELECT id, perfil FROM usuarios WHERE id = ?`, [userId]);
    if (!target || target.perfil !== 'aluno') {
      return res.status(404).json({ error: 'Aluno não encontrado.' });
    }

    const novoHash = await bcrypt.hash(novaSenha, 10);
    await dbRun(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, [novoHash, userId]);

    return res.json({ message: 'Senha do aluno redefinida com sucesso!' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao redefinir senha do aluno.' });
  }
});

app.delete('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await dbGet(`SELECT id, perfil FROM usuarios WHERE id = ?`, [userId]);
    if (!target || target.perfil !== 'aluno') {
      return res.status(404).json({ error: 'Aluno não encontrado.' });
    }

    await dbRun(`DELETE FROM usuarios WHERE id = ?`, [userId]);
    return res.json({ message: 'Cadastro do aluno removido e vagas liberadas.' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao remover aluno.' });
  }
});

// =========================================================
// ROTAS DE EVENTOS E INSCRIÇÕES (SQL)
// =========================================================

app.get('/api/eventos', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await dbAll(
      `SELECT
         e.id,
         e.titulo,
         e.ministrante,
         e.data_hora,
         e.local,
         e.categoria,
         e.vagas_totais,
         e.descricao,
         COUNT(i.id) AS inscritos_count,
         MAX(CASE WHEN i.usuario_id = ? THEN 1 ELSE 0 END) AS is_subscribed
       FROM eventos e
       LEFT JOIN inscricoes i ON i.evento_id = e.id
       GROUP BY e.id
       ORDER BY e.data_hora ASC`,
      [userId]
    );

    const eventos = rows.map(row => ({
      id: row.id,
      title: row.titulo,
      speaker: row.ministrante,
      datetime: row.data_hora,
      location: row.local,
      category: row.categoria,
      vagasTotais: row.vagas_totais,
      vagas: Math.max(0, row.vagas_totais - row.inscritos_count),
      subscribed: Boolean(row.is_subscribed),
      description: row.descricao || ''
    }));

    return res.json({ eventos });
  } catch (err) {
    console.error('Erro ao buscar eventos:', err);
    return res.status(500).json({ error: 'Erro ao carregar eventos do banco de dados.' });
  }
});

app.post('/api/eventos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const speaker = String(req.body.speaker || '').trim();
    const datetime = String(req.body.datetime || '').trim();
    const location = String(req.body.location || '').trim();
    const category = String(req.body.category || '').trim();
    const vagasTotais = parseInt(req.body.vagasTotais, 10);
    const description = String(req.body.description || '').trim();

    if (!title || !speaker || !datetime || !location || !['Minicurso', 'Palestra', 'Workshop'].includes(category)) {
      return res.status(400).json({ error: 'Dados obrigatórios do evento inválidos ou incompletos.' });
    }

    if (isNaN(vagasTotais) || vagasTotais < 1 || vagasTotais > 500) {
      return res.status(400).json({ error: 'Quantidade de vagas deve estar entre 1 e 500.' });
    }

    const result = await dbRun(
      `INSERT INTO eventos (titulo, ministrante, data_hora, local, categoria, vagas_totais, descricao)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, speaker, datetime, location, category, vagasTotais, description || 'Atividade acadêmica institucional promovida pelo Câmpus IFPB.']
    );

    return res.status(201).json({
      message: 'Evento cadastrado no banco de dados!',
      id: result.lastID
    });
  } catch (err) {
    console.error('Erro ao criar evento:', err);
    return res.status(500).json({ error: 'Erro interno ao salvar evento.' });
  }
});

app.delete('/api/eventos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const result = await dbRun(`DELETE FROM eventos WHERE id = ?`, [eventId]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Evento não encontrado.' });
    }

    return res.json({ message: 'Evento removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao excluir evento:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir evento.' });
  }
});

app.post('/api/eventos/:id/inscricao', authenticateToken, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const userId = req.user.id;

    const evento = await dbGet(
      `SELECT e.id, e.titulo, e.vagas_totais, COUNT(i.id) AS inscritos_count
       FROM eventos e
       LEFT JOIN inscricoes i ON i.evento_id = e.id
       WHERE e.id = ?
       GROUP BY e.id`,
      [eventId]
    );

    if (!evento) {
      return res.status(404).json({ error: 'Evento não encontrado.' });
    }

    const existingSub = await dbGet(
      `SELECT id FROM inscricoes WHERE usuario_id = ? AND evento_id = ?`,
      [userId, eventId]
    );

    if (existingSub) {
      await dbRun(`DELETE FROM inscricoes WHERE id = ?`, [existingSub.id]);
      return res.json({
        subscribed: false,
        message: `Inscrição cancelada em "${evento.titulo}".`
      });
    }

    if (evento.inscritos_count >= evento.vagas_totais) {
      return res.status(400).json({ error: 'Não há mais vagas disponíveis para este evento.' });
    }

    await dbRun(
      `INSERT INTO inscricoes (usuario_id, evento_id) VALUES (?, ?)`,
      [userId, eventId]
    );

    return res.status(201).json({
      subscribed: true,
      message: `Presença confirmada em "${evento.titulo}"!`
    });
  } catch (err) {
    console.error('Erro ao alternar inscrição:', err);
    return res.status(500).json({ error: 'Erro interno ao processar inscrição.' });
  }
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor IFEventos rodando em: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha crítica ao inicializar o banco SQLite:', err);
    process.exit(1);
  });