/* =========================================================
   IFEventos - Servidor API REST (Node.js + Express + SQLite)
   ========================================================= */

const path = require('path');
const express = require('express');
const cors = require('cors');

const { initDatabase } = require('./database/db');
const eventosRouter = require('./routes/eventos');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Verificação pública de autenticidade de certificado (sem login)
app.get('/api/certificados/verificar/:codigo', async (req, res) => {
  try {
    const c = await eventosRouter.buscarCertificado(String(req.params.codigo || '').toUpperCase());
    if (!c) return res.status(404).json({ valido: false, error: 'Certificado não encontrado.' });
    res.json({
      valido: true,
      codigo: c.codigo, aluno: c.aluno, evento: c.titulo, tipo: c.tipo,
      dataHora: c.dataHora, cargaHorariaMinutos: c.cargaHorariaMinutos
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar certificado.' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api', eventosRouter);

// JSON malformado e demais erros não tratados
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Requisição com JSON inválido.' });
  }
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
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
