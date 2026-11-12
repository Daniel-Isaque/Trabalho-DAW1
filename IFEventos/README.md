# IFEventos — Portal Acadêmico IFPB (Node.js + Express + SQLite)

Aplicação web full-stack desenvolvida para divulgação, busca, inscrição e gestão de eventos acadêmicos no âmbito do **Instituto Federal da Paraíba (IFPB)**, com autenticação JWT, cadastro único de estudantes, CRUD de senhas e persistência relacional em **SQLite**.

## Arquitetura do Projeto

```text
IFEventos/
├── database/
│   ├── db.js              # Conexão SQLite, criação das tabelas (usuarios, eventos, inscricoes) e seed inicial
│   └── ifeventos.db       # Banco de dados SQLite (gerado automaticamente na primeira execução)
├── middleware/
│   └── auth.js            # Verificação de token JWT e proteção de rotas administrativas
├── public/
│   ├── index.html         # Tela de autenticação split-screen, portal e modais
│   ├── css/
│   │   └── style.css      # Identidade visual IFPB, temas claro/escuro e layout responsivo
│   └── js/
│       ├── api.js         # Cliente HTTP (fetch) com envio automático do token JWT
│       └── app.js         # Lógica de interface, validações e CRUD de conta/senha
├── package.json           # Dependências do projeto Node.js
├── server.js              # Servidor Express e rotas REST da API
└── README.md              # Instruções de instalação e execução
```

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