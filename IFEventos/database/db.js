/* =========================================================
   IFEventos - Conexão SQLite e criação do schema relacional

   Modelo (herança por tabela de subtipo):

     usuarios (pai) ──┬── alunos       (1:1, FK composta id+tipo)
                      ├── professores  (1:1, FK composta id+tipo)
                      └── admin        (somente em usuarios.tipo)

     eventos (núcleo) ─┬── minicursos   (1:1, FK composta id+tipo)
                       ├── palestras    (1:1)
                       └── workshops    (1:1)
       + evento_ministrantes (N:N com professores ou nome externo)
       + evento_sessoes      (1:N encontros do evento)
       + locais              (N:1 com capacidade)
       + inscricoes          (aluno x evento, com lista de espera)
       + presencas           (inscrição x sessão)
       + certificados        (1:1 com inscrição)
   ========================================================= */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

const SCHEMA = [
  // ---------- USUÁRIOS (PAI) ----------
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('aluno', 'professor', 'admin')),
    status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'pendente', 'inativo')),
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id, tipo)
  )`,

  // ---------- USUÁRIOS (FILHAS) ----------
  `CREATE TABLE IF NOT EXISTS alunos (
    usuario_id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'aluno' CHECK(tipo = 'aluno'),
    matricula TEXT NOT NULL UNIQUE,
    curso TEXT NOT NULL,
    periodo INTEGER CHECK(periodo IS NULL OR periodo BETWEEN 1 AND 12),
    FOREIGN KEY (usuario_id, tipo) REFERENCES usuarios(id, tipo) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS professores (
    usuario_id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'professor' CHECK(tipo = 'professor'),
    siape TEXT NOT NULL UNIQUE,
    departamento TEXT NOT NULL,
    titulacao TEXT NOT NULL,
    FOREIGN KEY (usuario_id, tipo) REFERENCES usuarios(id, tipo) ON DELETE CASCADE
  )`,

  // ---------- LOCAIS ----------
  `CREATE TABLE IF NOT EXISTS locais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    capacidade INTEGER NOT NULL CHECK(capacidade >= 1)
  )`,

  // ---------- EVENTOS (NÚCLEO) ----------
  `CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    tipo TEXT NOT NULL CHECK(tipo IN ('Minicurso', 'Palestra', 'Workshop')),
    data_hora TEXT NOT NULL,
    local_id INTEGER NOT NULL REFERENCES locais(id),
    vagas_totais INTEGER NOT NULL CHECK(vagas_totais >= 1),
    status TEXT NOT NULL DEFAULT 'pendente'
      CHECK(status IN ('rascunho', 'pendente', 'aprovado', 'rejeitado', 'cancelado', 'encerrado')),
    justificativa_rejeicao TEXT,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id, tipo)
  )`,

  // ---------- EVENTOS (SUBTIPOS) ----------
  `CREATE TABLE IF NOT EXISTS minicursos (
    evento_id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'Minicurso' CHECK(tipo = 'Minicurso'),
    carga_horaria INTEGER NOT NULL CHECK(carga_horaria BETWEEN 1 AND 200),
    nivel TEXT NOT NULL DEFAULT 'iniciante' CHECK(nivel IN ('iniciante', 'intermediario', 'avancado')),
    pre_requisitos TEXT,
    frequencia_minima INTEGER NOT NULL DEFAULT 75 CHECK(frequencia_minima BETWEEN 50 AND 100),
    FOREIGN KEY (evento_id, tipo) REFERENCES eventos(id, tipo) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS palestras (
    evento_id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'Palestra' CHECK(tipo = 'Palestra'),
    publico_alvo TEXT,
    link_transmissao TEXT,
    FOREIGN KEY (evento_id, tipo) REFERENCES eventos(id, tipo) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS workshops (
    evento_id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'Workshop' CHECK(tipo = 'Workshop'),
    materiais_necessarios TEXT,
    vagas_por_equipe INTEGER NOT NULL DEFAULT 1 CHECK(vagas_por_equipe BETWEEN 1 AND 10),
    entrega_final TEXT,
    FOREIGN KEY (evento_id, tipo) REFERENCES eventos(id, tipo) ON DELETE CASCADE
  )`,

  // ---------- MINISTRANTES (N:N) E SESSÕES (1:N) ----------
  `CREATE TABLE IF NOT EXISTS evento_ministrantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    professor_id INTEGER REFERENCES professores(usuario_id) ON DELETE CASCADE,
    nome_externo TEXT,
    CHECK((professor_id IS NOT NULL AND nome_externo IS NULL)
       OR (professor_id IS NULL AND nome_externo IS NOT NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ministrante_prof
     ON evento_ministrantes(evento_id, professor_id) WHERE professor_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS evento_sessoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    inicio TEXT NOT NULL,
    duracao_minutos INTEGER NOT NULL CHECK(duracao_minutos BETWEEN 15 AND 720)
  )`,

  // ---------- INSCRIÇÕES, PRESENÇAS E CERTIFICADOS ----------
  `CREATE TABLE IF NOT EXISTS inscricoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aluno_id INTEGER NOT NULL REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'confirmada' CHECK(status IN ('confirmada', 'lista_espera', 'cancelada')),
    data_inscricao TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE(aluno_id, evento_id)
  )`,
  `CREATE TABLE IF NOT EXISTS presencas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inscricao_id INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
    sessao_id INTEGER NOT NULL REFERENCES evento_sessoes(id) ON DELETE CASCADE,
    UNIQUE(inscricao_id, sessao_id)
  )`,
  `CREATE TABLE IF NOT EXISTS certificados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inscricao_id INTEGER NOT NULL UNIQUE REFERENCES inscricoes(id) ON DELETE CASCADE,
    codigo TEXT NOT NULL UNIQUE,
    carga_horaria_minutos INTEGER NOT NULL,
    emitido_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS ix_inscricoes_evento ON inscricoes(evento_id, status)`,
  `CREATE INDEX IF NOT EXISTS ix_sessoes_evento ON evento_sessoes(evento_id)`,
  `CREATE INDEX IF NOT EXISTS ix_eventos_status ON eventos(status, data_hora)`
];

async function initDatabase() {
  await dbRun('PRAGMA foreign_keys = ON');

  // Banco da versão anterior (usuarios.perfil): recria do zero com o novo modelo.
  const cols = await dbAll(`PRAGMA table_info(usuarios)`);
  if (cols.length > 0 && !cols.some((c) => c.name === 'tipo')) {
    console.log('Schema antigo detectado: recriando o banco com o novo modelo relacional...');
    await dbRun('DROP TABLE IF EXISTS inscricoes');
    await dbRun('DROP TABLE IF EXISTS eventos');
    await dbRun('DROP TABLE IF EXISTS usuarios');
  }

  for (const sql of SCHEMA) {
    await dbRun(sql);
  }

  await require('./seed').runSeed({ dbRun, dbGet, dbAll });
}

module.exports = { db, dbRun, dbGet, dbAll, initDatabase };
