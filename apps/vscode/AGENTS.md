# VS Code 扩展 Agent 指南

## 打包前必须递增版本号(强制)

重新打包 vsix **之前**,必须先修改 `apps/vscode/package.json` 的 `version`(如 0.8.9 → 0.9.0),否则禁止打包。

原因:VS Code Marketplace 按 `package.json` 的 `version` 判重,同版本上传会被拒绝("version x.y.z already exists and cannot be modified"),届时只能再升版本重打一次,白跑一轮。打包产物文件名带版本号(`scripts/vsix-targets.mjs` 的 `vsixFileName()` 输出 `kimi-code-<version>-<target>.vsix`),文件名相同即说明版本号没改,一定不能上传。

流程固定为:

1. 改 `apps/vscode/package.json` 的 `version`(patch 递增)
2. `pnpm build`
3. `node scripts/vsix-package.mjs win32-x64`
4. 解包或 `verifyVsix` 确认产物内 `package.json` 是新版本号,且文件名含新版本号
5. 更新 `apps/vscode/CHANGELOG.md`(版本号 + 日期 + 条目)

即使功能代码一行没改、只是重打,版本号也必须递增。
