# IFEventos — Portal Acadêmico IFPB (Node.js + Express + SQLite)

Aplicação web full-stack desenvolvida para divulgação, busca, inscrição e gestão de eventos acadêmicos no âmbito do **Instituto Federal da Paraíba (IFPB)**, com autenticação JWT, cadastro único de estudantes, CRUD de senhas e persistência relacional em **SQLite**.

## Modelo de dados

**Usuários (herança por tabela de subtipo):** `usuarios` é a tabela pai (`tipo` = aluno | professor | admin, `status` = ativo | pendente | inativo). `alunos` (matrícula, curso, período) e `professores` (SIAPE, departamento, titulação) são filhas 1:1 com FK composta `(usuario_id, tipo)`, o que impede um professor de entrar na tabela de alunos. O admin existe só na tabela pai.

**Eventos (núcleo + detalhe por tipo):** `eventos` guarda o que é comum (título, local, vagas, status, criador). `minicursos`, `palestras` e `workshops` guardam os campos específicos de cada tipo. Também há `evento_ministrantes` (professor cadastrado ou nome externo), `evento_sessoes` (vários encontros), `locais` (com capacidade), `inscricoes` (com lista de espera), `presencas` (por sessão) e `certificados`.

**Fluxo do evento:** `rascunho → pendente → aprovado | rejeitado (com justificativa) → encerrado | cancelado`. Professor cria e envia; o admin aprova ou rejeita. Admin publica direto.

**Perfis:**
- **Aluno:** cadastra-se com `@academico.ifpb.edu.br`, inscreve-se (com lista de espera), emite certificado.
- **Professor:** cadastra-se com `@ifpb.edu.br` e fica pendente até o admin aprovar; cria eventos, vê inscritos e marca presença.
- **Admin:** aprova professores e eventos, gerencia usuários.

## Arquitetura do Projeto

```text
IFEventos/
├── database/
│   ├── db.js              # Conexão SQLite e schema relacional
│   ├── seed.js            # Admin, professores, alunos, locais e eventos de demonstração
│   └── ifeventos.db       # Gerado automaticamente (ignorado pelo git)
├── lib/eventos.js         # Carregamento, validação por tipo, conflito de local, lista de espera
├── middleware/auth.js     # JWT + requireTipo(...)
├── routes/                # auth.js, usuarios.js (admin), eventos.js
├── public/                # index.html, css/style.css, js/api.js, js/app.js
├── server.js
└── package.json
```

## Contas de demonstração (criadas no primeiro start)

| Tipo | E-mail | Senha |
|---|---|---|
| Admin | admin@ifpb.edu.br | 1234 |
| Professor | carlos.eduardo@ifpb.edu.br | 123456 |
| Aluno | ana.souza@academico.ifpb.edu.br | 123456 |

`roberto.nunes@ifpb.edu.br` é um professor pendente, para demonstrar a aprovação. Se o banco for de uma versão anterior, ele é recriado automaticamente no novo modelo.

## Como Executar o Projeto

1. Instale o **Node.js** (versão 18 ou superior).
2. Abra o terminal na pasta `IFEventos/` e instale as dependências:
   ```bash
   npm install
   ```
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse no navegador:
   ```text
   http://localhost:3000
   ```

## Equipe

- **Luan Bento**
- **Gustavo Dantas**
- **Daniel Isaque**

*Disciplina: Desenvolvimento de Aplicações Web I (DAW1) — IFPB.*