/* =========================================================
   IFEventos - Dados iniciais (admin, professores, alunos, locais e eventos)
   Datas dos eventos são relativas ao dia da primeira execução.
   ========================================================= */

const bcrypt = require('bcryptjs');

const SENHA_DEMO = '123456';
const SENHA_ADMIN = '1234';

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DDTHH:MM' no horário local, a partir de "daqui a N dias" às HH:MM
function dataRelativa(dias, hora, minuto = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hora)}:${pad(minuto)}`;
}

async function runSeed({ dbRun, dbGet, dbAll }) {
  const hashDemo = await bcrypt.hash(SENHA_DEMO, 10);

  // ---------- ADMIN ----------
  const admin = await dbGet(`SELECT id FROM usuarios WHERE tipo = 'admin' LIMIT 1`);
  if (!admin) {
    await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, status) VALUES (?, ?, ?, 'admin', 'ativo')`,
      ['Administrador IFPB', 'admin@ifpb.edu.br', await bcrypt.hash(SENHA_ADMIN, 10)]
    );
    console.log(`Admin padrão criado: admin@ifpb.edu.br / ${SENHA_ADMIN}`);
  }

  // ---------- PROFESSORES E ALUNOS DE DEMONSTRAÇÃO ----------
  const temDemo = await dbGet(`SELECT id FROM usuarios WHERE tipo <> 'admin' LIMIT 1`);
  if (temDemo) return;

  const professores = [
    ['Carlos Eduardo', 'carlos.eduardo@ifpb.edu.br', '1234501', 'Coordenação de Informática', 'Mestrado', 'ativo'],
    ['Rebeca Lima', 'rebeca.lima@ifpb.edu.br', '1234502', 'Coordenação de Informática', 'Doutorado', 'ativo'],
    ['Marcos Vinícius', 'marcos.vinicius@ifpb.edu.br', '1234503', 'Coordenação de Redes', 'Mestrado', 'ativo'],
    ['Juliana Costa', 'juliana.costa@ifpb.edu.br', '1234504', 'Design e Multimídia', 'Especialização', 'ativo'],
    ['Roberto Nunes', 'roberto.nunes@ifpb.edu.br', '1234505', 'Coordenação de Informática', 'Doutorado', 'pendente']
  ];
  const profId = {};
  for (const [nome, email, siape, departamento, titulacao, status] of professores) {
    const u = await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, status) VALUES (?, ?, ?, 'professor', ?)`,
      [nome, email, hashDemo, status]
    );
    await dbRun(
      `INSERT INTO professores (usuario_id, siape, departamento, titulacao) VALUES (?, ?, ?, ?)`,
      [u.lastID, siape, departamento, titulacao]
    );
    profId[nome] = u.lastID;
  }

  const alunos = [
    ['Ana Souza', 'ana.souza@academico.ifpb.edu.br', '20241001', 'Sistemas para Internet', 3],
    ['Bruno Lima', 'bruno.lima@academico.ifpb.edu.br', '20241002', 'Sistemas para Internet', 3],
    ['Carla Dias', 'carla.dias@academico.ifpb.edu.br', '20231003', 'Técnico em Informática', 5]
  ];
  const alunoId = {};
  for (const [nome, email, matricula, curso, periodo] of alunos) {
    const u = await dbRun(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, status) VALUES (?, ?, ?, 'aluno', 'ativo')`,
      [nome, email, hashDemo]
    );
    await dbRun(
      `INSERT INTO alunos (usuario_id, matricula, curso, periodo) VALUES (?, ?, ?, ?)`,
      [u.lastID, matricula, curso, periodo]
    );
    alunoId[nome] = u.lastID;
  }

  // ---------- LOCAIS ----------
  const locais = [
    ['Laboratório de Informática 03', 25],
    ['Auditório Principal', 120],
    ['Laboratório de Redes 01', 30],
    ['Miniauditório Bloco B', 60],
    ['Laboratório de Design e Multimídia', 25],
    ['Ginásio / Laboratórios Integrados', 200]
  ];
  const localId = {};
  for (const [nome, cap] of locais) {
    const r = await dbRun(`INSERT INTO locais (nome, capacidade) VALUES (?, ?)`, [nome, cap]);
    localId[nome] = r.lastID;
  }

  // ---------- EVENTOS ----------
  const adminRow = await dbGet(`SELECT id FROM usuarios WHERE tipo = 'admin' LIMIT 1`);

  async function criarEvento(e) {
    const inicioMin = e.sessoes.map((s) => s[0]).sort()[0];
    const r = await dbRun(
      `INSERT INTO eventos (titulo, descricao, tipo, data_hora, local_id, vagas_totais, status, justificativa_rejeicao, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.titulo, e.descricao, e.tipo, inicioMin, localId[e.local], e.vagas, e.status, e.justificativa || null, e.criadoPor]
    );
    const id = r.lastID;
    for (const m of e.ministrantes) {
      if (profId[m]) {
        await dbRun(`INSERT INTO evento_ministrantes (evento_id, professor_id) VALUES (?, ?)`, [id, profId[m]]);
      } else {
        await dbRun(`INSERT INTO evento_ministrantes (evento_id, nome_externo) VALUES (?, ?)`, [id, m]);
      }
    }
    const sessaoIds = [];
    for (const [inicio, dur] of e.sessoes) {
      const s = await dbRun(
        `INSERT INTO evento_sessoes (evento_id, inicio, duracao_minutos) VALUES (?, ?, ?)`,
        [id, inicio, dur]
      );
      sessaoIds.push(s.lastID);
    }
    const d = e.detalhes;
    if (e.tipo === 'Minicurso') {
      await dbRun(
        `INSERT INTO minicursos (evento_id, carga_horaria, nivel, pre_requisitos, frequencia_minima) VALUES (?, ?, ?, ?, ?)`,
        [id, d.cargaHoraria, d.nivel, d.preRequisitos || null, d.frequenciaMinima || 75]
      );
    } else if (e.tipo === 'Palestra') {
      await dbRun(
        `INSERT INTO palestras (evento_id, publico_alvo, link_transmissao) VALUES (?, ?, ?)`,
        [id, d.publicoAlvo || null, d.linkTransmissao || null]
      );
    } else {
      await dbRun(
        `INSERT INTO workshops (evento_id, materiais_necessarios, vagas_por_equipe, entrega_final) VALUES (?, ?, ?, ?)`,
        [id, d.materiais || null, d.vagasPorEquipe || 1, d.entregaFinal || null]
      );
    }
    return { id, sessaoIds };
  }

  const carlos = profId['Carlos Eduardo'];
  const marcos = profId['Marcos Vinícius'];
  const juliana = profId['Juliana Costa'];
  const rebeca = profId['Rebeca Lima'];

  const evJs = await criarEvento({
    titulo: 'Introdução ao Desenvolvimento Web com JS',
    descricao: 'Aprenda os fundamentos de manipulação do DOM, eventos e consumo de APIs REST com JavaScript moderno.',
    tipo: 'Minicurso', local: 'Laboratório de Informática 03', vagas: 20, status: 'aprovado', criadoPor: carlos,
    ministrantes: ['Carlos Eduardo'],
    sessoes: [[dataRelativa(3, 19), 120], [dataRelativa(5, 19), 120]],
    detalhes: { cargaHoraria: 4, nivel: 'iniciante', preRequisitos: 'Noções básicas de HTML e CSS.', frequenciaMinima: 75 }
  });

  await criarEvento({
    titulo: 'Inteligência Artificial Generativa na Educação',
    descricao: 'Discussão sobre aplicações práticas, ética acadêmica e uso responsável de modelos de linguagem no ensino superior.',
    tipo: 'Palestra', local: 'Auditório Principal', vagas: 60, status: 'aprovado', criadoPor: rebeca,
    ministrantes: ['Rebeca Lima'],
    sessoes: [[dataRelativa(6, 14, 30), 90]],
    detalhes: { publicoAlvo: 'Estudantes e docentes de todos os cursos', linkTransmissao: 'https://meet.google.com/ifeventos-ia' }
  });

  await criarEvento({
    titulo: 'Workshop de Git, GitHub e Fluxo Colaborativo',
    descricao: 'Oficina mão na massa sobre versionamento de código, branches, pull requests e resolução de conflitos em equipe.',
    tipo: 'Workshop', local: 'Laboratório de Redes 01', vagas: 25, status: 'aprovado', criadoPor: marcos,
    ministrantes: ['Marcos Vinícius'],
    sessoes: [[dataRelativa(10, 9), 240]],
    detalhes: { materiais: 'Notebook com Git instalado e conta no GitHub.', vagasPorEquipe: 2, entregaFinal: 'Pull request aprovado em repositório de equipe.' }
  });

  await criarEvento({
    titulo: 'Segurança da Informação e Boas Práticas Web',
    descricao: 'Principais vulnerabilidades em aplicações web modernas (XSS, CSRF, SQL Injection) e técnicas essenciais de prevenção.',
    tipo: 'Palestra', local: 'Miniauditório Bloco B', vagas: 40, status: 'aprovado', criadoPor: adminRow.id,
    ministrantes: ['Esp. Fernanda Alves'],
    sessoes: [[dataRelativa(14, 16), 90]],
    detalhes: { publicoAlvo: 'Estudantes de Informática e Redes' }
  });

  await criarEvento({
    titulo: 'Prototipagem de Interfaces e UX Design no Figma',
    descricao: 'Construção de wireframes, sistemas de design responsivos e testes de heurísticas de usabilidade.',
    tipo: 'Minicurso', local: 'Laboratório de Design e Multimídia', vagas: 20, status: 'pendente', criadoPor: juliana,
    ministrantes: ['Juliana Costa'],
    sessoes: [[dataRelativa(20, 14), 120], [dataRelativa(22, 14), 120]],
    detalhes: { cargaHoraria: 4, nivel: 'intermediario', preRequisitos: 'Conta gratuita no Figma.', frequenciaMinima: 75 }
  });

  await criarEvento({
    titulo: 'Maratona de Algoritmos e Estrutura de Dados',
    descricao: 'Desafio prático de resolução de problemas lógicos e otimização de algoritmos voltado para estudantes do câmpus.',
    tipo: 'Workshop', local: 'Ginásio / Laboratórios Integrados', vagas: 50, status: 'rejeitado', criadoPor: marcos,
    justificativa: 'Ginásio reservado para os jogos internos nesta data. Reenvie com outra data ou local.',
    ministrantes: ['Marcos Vinícius', 'Coordenação de Computação IFPB'],
    sessoes: [[dataRelativa(28, 8, 30), 300]],
    detalhes: { materiais: 'Notebook.', vagasPorEquipe: 3, entregaFinal: 'Lista de problemas resolvidos.' }
  });

  // Evento já realizado (permite demonstrar presença e certificado)
  const evPy = await criarEvento({
    titulo: 'Lógica de Programação com Python',
    descricao: 'Variáveis, estruturas de decisão e repetição com exercícios guiados.',
    tipo: 'Minicurso', local: 'Laboratório de Informática 03', vagas: 20, status: 'encerrado', criadoPor: carlos,
    ministrantes: ['Carlos Eduardo'],
    sessoes: [[dataRelativa(-10, 19), 120], [dataRelativa(-8, 19), 120]],
    detalhes: { cargaHoraria: 4, nivel: 'iniciante', frequenciaMinima: 75 }
  });

  // ---------- INSCRIÇÕES E PRESENÇAS ----------
  async function inscrever(aluno, evento, status = 'confirmada') {
    const r = await dbRun(
      `INSERT INTO inscricoes (aluno_id, evento_id, status) VALUES (?, ?, ?)`,
      [alunoId[aluno], evento.id, status]
    );
    return r.lastID;
  }

  await inscrever('Ana Souza', evJs);
  await inscrever('Bruno Lima', evJs);

  const inscAna = await inscrever('Ana Souza', evPy);
  const inscBruno = await inscrever('Bruno Lima', evPy);
  for (const sid of evPy.sessaoIds) {
    await dbRun(`INSERT INTO presencas (inscricao_id, sessao_id) VALUES (?, ?)`, [inscAna, sid]);
  }
  await dbRun(`INSERT INTO presencas (inscricao_id, sessao_id) VALUES (?, ?)`, [inscBruno, evPy.sessaoIds[0]]);

  console.log('Dados de demonstração criados (professores/alunos com senha ' + SENHA_DEMO + ').');
}

module.exports = { runSeed };
