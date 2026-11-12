/* =========================================================
   IFEventos - Conexão SQLite, Criação de Tabelas e Seed Inicial
   ========================================================= */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'ifeventos.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco SQLite:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite em:', DB_PATH);
  }
});

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDatabase() {
  await dbRun('PRAGMA foreign_keys = ON');

  // 1. Tabela de Usuários (Cadastro único por e-mail + senha criptografada)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK(perfil IN ('aluno', 'admin')) DEFAULT 'aluno',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Tabela de Eventos Acadêmicos
  await dbRun(`
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      ministrante TEXT NOT NULL,
      data_hora TEXT NOT NULL,
      local TEXT NOT NULL,
      categoria TEXT NOT NULL CHECK(categoria IN ('Minicurso', 'Palestra', 'Workshop')),
      vagas_totais INTEGER NOT NULL CHECK(vagas_totais >= 1),
      descricao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Tabela de Inscrições (Relacionamento N:N entre Usuários e Eventos)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS inscricoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      evento_id INTEGER NOT NULL,
      data_inscricao DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, evento_id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    )
  `);

  // Cria o Administrador padrão (senha inicial: 1234) se ainda não existir
  const adminExists = await dbGet(`SELECT id FROM usuarios WHERE perfil = 'admin' LIMIT 1`);
  if (!adminExists) {
    const adminHash = await bcrypt.hash('1234', 10);
    await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, ?)`,
      ['Administrador IFPB', 'admin@ifpb.edu.br', adminHash, 'admin']
    );
    console.log('Conta de Administrador padrão criada (senha inicial: 1234).');
  }

  // Popula eventos iniciais caso a tabela esteja vazia
  const countRow = await dbGet(`SELECT COUNT(*) AS total FROM eventos`);
  if (countRow && countRow.total === 0) {
    const initialEvents = [
      {
        titulo: 'Introdução ao Desenvolvimento Web com JS',
        ministrante: 'Prof. Carlos Eduardo',
        data_hora: '2026-11-12T19:00',
        local: 'Laboratório de Informática 03',
        categoria: 'Minicurso',
        vagas_totais: 20,
        descricao: 'Aprenda os fundamentos de manipulação do DOM, eventos e consumo de APIs REST com JavaScript moderno.'
      },
      {
        titulo: 'Inteligência Artificial Generativa na Educação',
        ministrante: 'Dra. Rebeca Lima',
        data_hora: '2026-11-14T14:30',
        local: 'Auditório Principal',
        categoria: 'Palestra',
        vagas_totais: 60,
        descricao: 'Discussão sobre aplicações práticas, ética acadêmica e uso responsável de modelos de linguagem no ensino superior.'
      },
      {
        titulo: 'Workshop de Git, GitHub e Fluxo Colaborativo',
        ministrante: 'Prof. Marcos Vinícius',
        data_hora: '2026-11-17T09:00',
        local: 'Laboratório de Redes 01',
        categoria: 'Workshop',
        vagas_totais: 25,
        descricao: 'Oficina mão na massa sobre versionamento de código, branches, pull requests e resolução de conflitos em equipe.'
      },
      {
        titulo: 'Segurança da Informação e Boas Práticas Web',
        ministrante: 'Esp. Fernanda Alves',
        data_hora: '2026-11-21T16:00',
        local: 'Miniauditório Bloco B',
        categoria: 'Palestra',
        vagas_totais: 40,
        descricao: 'Principais vulnerabilidades em aplicações web modernas (XSS, CSRF, SQL Injection) e técnicas essenciais de prevenção.'
      },
      {
        titulo: 'Prototipagem de Interfaces e UX Design no Figma',
        ministrante: 'Profa. Juliana Costa',
        data_hora: '2026-11-26T14:00',
        local: 'Laboratório de Design e Multimídia',
        categoria: 'Minicurso',
        vagas_totais: 20,
        descricao: 'Construção de wireframes, sistemas de design responsivos e testes de heurísticas de usabilidade.'
      },
      {
        titulo: 'Maratona de Algoritmos e Estrutura de Dados',
        ministrante: 'Coordenação de Computação IFPB',
        data_hora: '2026-12-05T08:30',
        local: 'Ginásio / Laboratórios Integrados',
        categoria: 'Workshop',
        vagas_totais: 50,
        descricao: 'Desafio prático de resolução de problemas lógicos e otimização de algoritmos voltado para estudantes do câmpus.'
      }
    ];

    for (const evt of initialEvents) {
      await dbRun(
        `INSERT INTO eventos (titulo, ministrante, data_hora, local, categoria, vagas_totais, descricao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [evt.titulo, evt.ministrante, evt.data_hora, evt.local, evt.categoria, evt.vagas_totais, evt.descricao]
      );
    }
    console.log('6 eventos acadêmicos iniciais inseridos no SQLite.');
  }
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase
};