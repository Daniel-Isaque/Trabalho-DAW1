/* =========================================================
   IFEventos - Middlewares de Autenticação JWT e Autorização por tipo
   ========================================================= */

const jwt = require('jsonwebtoken');
const { dbGet } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'ifeventos_ifpb_chave_secreta_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Faça login para continuar.' });
  }

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Sessão expirada ou token inválido. Faça login novamente.' });
    }

    try {
      // Revalida no banco: conta removida, desativada ou com tipo alterado invalida o token.
      const user = await dbGet(
        `SELECT id, nome, email, tipo, status FROM usuarios WHERE id = ?`,
        [payload.id]
      );
      if (!user || user.status !== 'ativo') {
        return res.status(403).json({ error: 'Sua conta não está ativa. Faça login novamente.' });
      }
      req.user = { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo };
      next();
    } catch (e) {
      console.error('Erro ao validar sessão:', e);
      res.status(500).json({ error: 'Erro interno ao validar sessão.' });
    }
  });
}

function requireTipo(...tipos) {
  return (req, res, next) => {
    if (!req.user || !tipos.includes(req.user.tipo)) {
      return res.status(403).json({ error: 'Permissão negada para o seu tipo de conta.' });
    }
    next();
  };
}

module.exports = {
  JWT_SECRET,
  authenticateToken,
  requireTipo,
  requireAdmin: requireTipo('admin')
};
