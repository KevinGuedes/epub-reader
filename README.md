# EPUB Reader

Leitor de EPUB para desktop Linux. Funciona 100% offline, com um capítulo por vez, personalização da leitura e posição salva.

**Stack:** Electron + Vite (electron-vite) + React + TypeScript · epub.js (renderização) · epub2 (metadados/capa no main) · better-sqlite3 · zustand

## Rodar

Requer Node 22+.

```bash
npm install
npm run dev        # desenvolvimento
npm run typecheck
npm run dist       # gera AppImage e .deb em dist/
```

## Funcionalidades

1. **Pasta de livros:** na primeira abertura você escolhe a pasta. Ela é varrida recursivamente atrás de `*.epub` (pastas ocultas são ignoradas) e a escolha fica salva. Ao abrir o app, e no botão "Atualizar", só arquivos novos/alterados são reindexados; arquivos removidos saem da biblioteca. Se a pasta estiver indisponível (disco desmontado, por exemplo), nada é apagado.
2. **Personalização** (ícone `Aa`): temas Areia (padrão), Claro, Sépia, Café, Escuro e Preto, mais cores livres de fundo, texto e links (sliders e controles seguem as cores do tema); fonte (do livro, serifada, sem serifa, monoespaçada ou qualquer fonte instalada); tamanho; espaçamento entre linhas; espaço entre parágrafos; largura da coluna; alinhamento. Aplica ao vivo e vale para todos os livros.
3. **Posição de leitura:** salva por CFI (debounce de 600 ms, e ao fechar). Sobrevive a mudança de fonte/tamanho. A biblioteca mostra o % lido e ordena por "lidos recentemente".

4. **Tradução:** selecione uma palavra ou frase curta (até 100 caracteres) e aparece o botão "Traduzir". Clicar nele, ou apertar `T`, abre o Google Tradutor (para português) no navegador do sistema. O idioma de origem vem dos metadados do livro, ou é detectado automaticamente. Precisa de internet; o resto do app continua offline. O texto selecionado é enviado ao Google. `Esc` dispensa o botão.

Os painéis (índice e personalização) fecham ao clicar fora deles, inclusive no texto do livro. Dropdowns e barras de rolagem seguem as cores do tema.

5. **Um capítulo por vez:** só o capítulo atual é carregado (a barra de rolagem não muda de tamanho enquanto você lê). Botões "← Capítulo anterior" / "Próximo capítulo →" aparecem no começo e no fim de cada capítulo. No fim do livro aparece "Fim do livro".
6. **Busca no livro** (`Ctrl+F`): ignora maiúsculas, acentos e espaços repetidos; mostra "3 de 41", `Enter` / `Shift+Enter` navegam entre as ocorrências (até 500) e a atual fica destacada. Limitação: a frase precisa estar dentro de um mesmo trecho de texto (uma busca que atravessa `<em>`, por exemplo, não acha).
7. **Tamanho da fonte:** `Ctrl +` / `Ctrl −` (12–40 px) e `Ctrl 0` volta ao padrão (19 px). Vale também com o foco dentro do texto.
8. **Modo imersivo** (ligado por padrão; desligue em `Aa`): as barras de cima e de baixo somem após ~2,5 s sem uso. Elas voltam ao levar o mouse até a borda superior/inferior da janela, e ficam visíveis enquanto o mouse estiver sobre elas, houver painel ou busca abertos, ou o foco estiver nelas.
9. **Tela cheia:** `F11` ou o botão no topo. `Esc` sai da tela cheia (sem voltar à biblioteca).

Os painéis (índice e personalização) fecham ao clicar fora deles, inclusive no texto do livro. Dropdowns e barras de rolagem seguem as cores do tema.

Topo (biblioteca e leitura, mesma posição): `Imersivo` liga/desliga o modo imersivo, `Aa` abre a personalização e o último botão alterna tela cheia.

Atalhos: `↑ ↓ PgUp PgDn Espaço Home End` rolam; `→` / `←` mudam de capítulo (também `PgDn`/`Espaço` no fim do capítulo e `PgUp`/`Shift+Espaço` no começo); `Ctrl+F` busca; `Ctrl +/−/0` fonte; `F11` tela cheia; `T` traduz a seleção; `Esc` fecha seleção, busca ou painel e, por fim, volta à biblioteca. Em desenvolvimento, `F12` abre as ferramentas do desenvolvedor (o app não tem barra de menus).

## Estrutura

```
src/main/       db.ts (SQLite + migrações), library.ts (varredura, metadados, capas, progresso), ipc.ts, index.ts
src/preload/    API tipada exposta via contextBridge
src/shared/     tipos, canais IPC, validação das configurações
src/renderer/   React: Library, Reader, SettingsPanel, TocPanel, themes.ts (CSS injetado nos capítulos)
```

Dados do app (banco e capas) ficam na pasta de dados do Electron, provavelmente `~/.config/EPUB Reader/` (`library.db`, `covers/`). Confirme no primeiro uso, pois o nome vem do `productName` do `package.json`. Os EPUBs nunca são modificados.

## Segurança

`contextIsolation`, `sandbox` e CSP estritos. O conteúdo do livro roda em iframe sem scripts. O renderer não acessa disco nem SQLite; só a API do preload, com argumentos validados no main. Links http(s) dentro do livro abrem no navegador do sistema.

## Ícone no .deb

O `.desktop` gerado casa com a janela por `desktopName` (`package.json`) + `StartupWMClass` + classe da janela (`epub-reader`). Se o ícone da barra de tarefas não aparecer depois de reinstalar, rode `xprop WM_CLASS` clicando na janela (X11) e confira se o valor é `epub-reader`; `sudo update-desktop-database` e `gtk-update-icon-cache` podem ser necessários, e às vezes é preciso sair/entrar da sessão.

## Limitações conhecidas

- EPUBs com DRM não abrem. Só EPUB 2/3 sem DRM.
- O progresso (%) é aproximado até as "locations" do livro serem calculadas na primeira abertura (alguns segundos em livros grandes; depois ficam em cache).
- Sem anotações/destaques do usuário (a base para isso já existe: CFI + epub.js).
- Ao abrir um livro cuja posição foi salva numa versão anterior (modo contínuo), a posição pode cair um parágrafo fora do lugar.
