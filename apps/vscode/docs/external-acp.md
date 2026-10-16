# External ACP backend

The extension keeps the embedded Kimi SDK as its default backend. To route VS
Code through `kimi-subscription-router`, set these settings and reload the
window:

```json
{
  "kimifork.backend": "externalAcp",
  "kimifork.acpCommand": "/absolute/path/kimi-subscription-router",
  "kimifork.acpTarget": "kimi-vscode-fork",
  "kimifork.acpAccounts": []
}
```

The extension starts the command without a shell and appends one `--target`
argument plus one `--account` pair for every configured account. An empty
`acpAccounts` array lets the router load the target pool saved by Kimi
Subscription Router; when that target has no saved pool, it uses all accounts
marked as routable. Use a
different target and a non-overlapping account list for each ACP client, for
example:

```text
VS Code fork -> target kimi-vscode-fork -> account-b, account-c
Zed          -> target zed              -> account-d
Kimi CLI     -> account-a (not routable)
```

The Router app can create these target pools and merge the four `kimifork.*`
keys into `<workspace>/.vscode/settings.json`. Keep `acpAccounts` empty when
the app is the source of truth. A non-empty extension account list is passed as
explicit `--account` arguments and overrides the app target pool.

The router's account lease prevents an account from being started by two ACP
targets at once. The extension does not copy credentials, edit Kimi CLI homes,
or perform login/logout in external mode. Authenticate and change account
routing in Kimi Subscription Router or Kimi CLI first.

External mode currently supports the core ACP session flow: initialize,
session creation/loading, prompts, streaming text/thinking/tool updates,
cancellation, permission requests, listing and deleting sessions, plus ACP
workspace file reads/writes and terminal lifecycle requests. File and terminal
paths are constrained to the active session workspace and do not follow a
symlink outside it. SDK-specific features such as MCP administration, goals,
swarm mode, context export, and session forking are intentionally reported as
unsupported instead of falling back to the embedded SDK.
