# Kimi Code (Fork) — 个人修改版

> **修改版声明**:本插件是基于 Moonshot AI 官方 [Kimi Code for VS Code](https://github.com/MoonshotAI/kimi-code)(Apache-2.0)的个人修改版,与官方版隔离:扩展 ID `moonshot-ai.kimicode-vscode-fork`,displayName "Kimi Code (Fork)",命令/设置前缀均为 `kimifork.*`,可与官方版共存。修改内容与构建说明见仓库根 [README](../../README.md)。

AI coding assistant for VS Code, built for long-context workflows and complex coding tasks.

## Features

- **Works alongside you**: Kimi autonomously explores your codebase, reads and writes code, and runs terminal commands with your permission
- **Thinking controls**: Toggle reasoning or choose a model-supported thinking effort
- **Provider-aware models**: Distinguish and select same-named models across configured providers
- **Native editor integration**: Review AI-proposed changes directly in VS Code's diff viewer
- **MCP support**: Extend capabilities with Model Context Protocol servers
- **Slash commands**: Quick actions like `/init` to analyze your project and `/compact` to manage context

## Install

Kimi Code requires VS Code 1.100.0 or later.

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=moonshot-ai.kimi-code)
2. Open a folder in VS Code
3. Click the Kimi icon in the Activity Bar
4. Sign in with a [kimi.com/code](https://www.kimi.com/code) subscription, or use a provider already configured in the shared `config.toml`

The extension runs the Kimi Code Node SDK in the VS Code Extension Host. When
the extension and the Kimi Code terminal app resolve to the same
`KIMI_CODE_HOME`, they share `config.toml`, MCP configuration, login state, and
sessions. The system-level `KIMI_CODE_HOME` environment variable is supported;
there is no separate VS Code setting for it. Do not run the same session from
both applications at the same time, because cross-process session locking is
not guaranteed.

After upgrading from version 0.5.x, the extension prompts before migrating any
legacy data it finds. Migration copies or merges data into the current Kimi Code
home and does not delete the legacy source. Legacy Kimi Code OAuth and MCP OAuth
credentials are not copied, so those connections must be authorized again.
See [the changelog](CHANGELOG.md) for the full compatibility notes.

## Docs

Official doc for Kimi Code can be found at [www.kimi.com/code/docs](https://www.kimi.com/code/docs/en/kimi-code-for-vscode/guides/getting-started.html)

## License

[Apache-2.0](LICENSE)
