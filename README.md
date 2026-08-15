# Agent Workspace for VS Code

Agent Workspace is a local control plane for routing coding tasks to specialized CLI agents in one project. Each agent has its own specialties, instructions file, working directory, chat or terminal session, and persisted project configuration.

The MVP supports the local Codex CLI and a generic Custom CLI escape hatch. **Modo Economia** accepts a task directly in the global chat and asks an economical Codex model to choose between the configured agents from the user's intent, task complexity, complete agent instructions, specialties, model, and reasoning profile. It explains the AI decision and waits for confirmation before starting. The control plane uses the authenticated local Codex app-server and does not add telemetry, accounts, a backend, API keys, or a separate OpenAI API integration.

## Modo Economia

Use the toggle action in the **Agents** view to enter the global economy chat. While active, the Agents section is hidden so the chat uses the available space, and the active toggle moves to the Chat header. Turning it off restores the Agents section and the previously selected conversation. You do not select an agent before submitting an economy task. Agent Workspace then:

1. Reads the local profiles and complete instructions of available Codex agents.
2. Sends the task and those profiles to an isolated, read-only Codex analysis turn with a strict JSON output schema.
3. Lets the AI interpret the user's intent, classify complexity, and compare required capabilities with cost versus reliability.
4. Validates locally that the returned agent exists and uses the model and reasoning effort configured on that agent.
5. Explains which AI model made the routing decision before any conversation is created.
6. Records the accepted decision in the conversation for later inspection.

There is no keyword-scoring fallback. If the AI response is invalid or selects an unknown agent, the task is not dispatched and the user receives an error.

This first control-plane increment routes one task to one confirmed agent. It does not yet run validation commands, automatically escalate failed work, or coordinate parallel writes.

## Por que este projeto existe

Trabalhar com vários agentes normalmente exige manter diversos terminais abertos e lembrar manualmente o papel de cada um. O Agent Workspace reúne essa experiência em uma interface visual nativa do VS Code.

O MVP prioriza este fluxo:

```text
Criar agente
  -> escrever instruções
  -> iniciar terminal
  -> trabalhar com vários agentes
  -> gerenciar tudo pela barra lateral
```

## Funcionalidades

- Criação de agentes Codex e Custom CLI.
- Arquivo de instruções independente para cada agente.
- Diretório de trabalho configurável.
- Terminal independente por agente.
- Ações para iniciar, focar, parar e reiniciar.
- Edição e exclusão com confirmação.
- Estados `Running` e `Stopped`.
- Configuração persistente e compartilhável no projeto.
- Funcionamento totalmente local, sem telemetria ou envio de código.

## Requisitos

- [Visual Studio Code](https://code.visualstudio.com/)
- Node.js e npm
- Codex CLI instalado, autenticado e disponível no `PATH`, caso sejam usados agentes Codex

O provider Custom CLI também aceita comandos como `claude`, `gemini`, `opencode` ou `aider`, desde que a ferramenta correspondente já esteja instalada.

## Desenvolvimento

Clone o projeto e instale as dependências:

```bash
git clone https://github.com/cortoppassi/agent-workspace-vscode.git
cd agent-workspace-vscode
npm install
npm run compile
code .
```

No VS Code, pressione `F5` e selecione **Run Agent Workspace**. Uma nova janela chamada **Extension Development Host** será aberta com a extensão carregada.

## Como testar

1. Open **Agent Workspace** in the Activity Bar.
2. Select **Create Agent**.
3. Enter `Backend`, choose `Codex`, use `.` as the working directory, and add specialties such as `API, SQL, authentication`.
4. Edit the newly opened `.agent-workspace/agents/backend.md` file.
5. Click the agent to open its current embedded conversation and send a message.
6. Expand the agent and select **New Conversation** to start another independent conversation.
7. Select a conversation from the list to reopen its history; use its context menu to rename or remove it.
8. Use the compact chat selectors to choose the Codex model and reasoning effort for the agent; verify that another conversation for the same agent keeps the selection.
9. Expand **Details** below the chat to inspect that conversation's token usage; the agent row shows the combined total.
10. Use **Start** from the agent actions or context menu when you want an interactive terminal named `Backend`.
11. Create a second Codex agent with different specialties and model settings, select **Modo Economia**, and describe a task in the chat without choosing an agent.
12. Verify that the accepted decision appears above the new conversation and in its tree tooltip.

1. Abra uma pasta de projeto em **File > Open Folder**.
2. Abra **Agent Workspace** na Activity Bar.
3. Clique em **Create Agent**.
4. Informe o nome `Backend`, escolha `Codex` e use `.` como diretório.
5. Edite o arquivo `.agent-workspace/agents/backend.md` que será aberto.
6. Clique no agente para iniciar seu terminal.
7. Crie outros agentes e teste as ações de iniciar, focar, parar, reiniciar, editar e excluir.

## Configuração dos agentes

Ao criar o primeiro agente, a extensão gera:

```text
.agent-workspace/
|-- config.json
`-- agents/
    `-- backend.md
```

Os caminhos gravados em `config.json` são relativos ao workspace. Isso permite versionar a pasta `.agent-workspace` e compartilhar a mesma equipe de agentes com outros desenvolvedores.

Antes de versionar um agente Custom CLI, revise seu comando. Ele será executado exatamente como estiver configurado e deve funcionar nas máquinas dos demais colaboradores.

## Como colaborar

Como o repositório é privado, o responsável deve primeiro adicionar cada participante em **Settings > Collaborators > Add people**. Depois de aceitar o convite, qualquer colaborador pode clonar o projeto.

Para cada mudança, crie uma branch a partir da `main` atualizada:

```bash
git switch main
git pull --ff-only
git switch -c feature/nome-da-mudanca
```

Faça alterações pequenas e focadas. Antes do commit, execute:

```bash
npm run check-types
npm run lint
npm test
npm run compile
```

Depois publique a branch:

```bash
git add <arquivos-alterados>
git commit -m "feat: descreva a mudança"
git push -u origin feature/nome-da-mudanca
```

No GitHub, abra um Pull Request para a `main`, explique o que mudou e informe quais validações foram executadas. Peça a revisão de pelo menos uma pessoa e resolva os comentários antes do merge.

Convenções sugeridas para branches:

- `feature/...` para funcionalidades.
- `fix/...` para correções.
- `docs/...` para documentação.
- `test/...` para testes.

Evite commits diretos na `main`, force-push e mudanças sem relação entre si no mesmo Pull Request.

## Compartilhando o projeto e os agentes

Há duas formas de compartilhar:

- **Código da extensão:** convide a pessoa para este repositório e use branches e Pull Requests.
- **Configuração dos agentes:** versione `.agent-workspace/config.json` e os arquivos `.agent-workspace/agents/*.md` no repositório em que a extensão estiver sendo usada.

Não coloque tokens, credenciais, caminhos específicos da sua máquina ou dados secretos nas instruções e comandos compartilhados.

## Comandos úteis

```bash
npm run check-types  # valida os tipos TypeScript
npm run lint         # executa o ESLint
npm test             # executa os testes automatizados
npm run compile      # gera o bundle da extensão
npm run package      # gera um arquivo VSIX local
```

O comando `npm run package` não publica nada automaticamente.

## Arquitetura

```text
Extension
|-- TreeView ------> AgentManager ------> ConfigManager
|-- Commands ------> AgentManager
`-- Commands ------> TerminalManager ---> AgentProvider
                                         |-- CodexProvider
                                         `-- GenericCliProvider
```

Mais detalhes estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). O escopo concluído está em [docs/MVP.md](docs/MVP.md), e as ideias futuras estão em [docs/ROADMAP.md](docs/ROADMAP.md).

## Limitações atuais

- Em workspaces multi-root, apenas a primeira pasta é utilizada.
- O status não diferencia agentes ociosos, trabalhando ou aguardando entrada.
- As CLIs precisam estar previamente instaladas e disponíveis no `PATH`.

## Licença

Este projeto é distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
