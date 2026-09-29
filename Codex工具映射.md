# Codex 工具映射

## 状态

个人插件：`sql-file-manager`；候选展示名：`SQL 文件管理器`。固定 HTTPS 地址为：<https://liuguangxu9.github.io/sql-file-shelf/>

## 启用条件

1. 在 Edge 中打开上述地址，点击地址栏中的“安装此应用”。
2. 在应用窗口中点击“选择工作区”，选择需要管理的本地目录。
3. 以后从开始菜单的“SQL 文件架”启动；若 Edge 撤销过权限，点击“恢复访问”。

当 Codex 提交单独 `@SQL 文件管理器` 的调用且不附加文字时，只返回固定正式链接，不启动浏览器。只有用户在 @ 后明确写“打开”时，技能才调用插件的本地 MCP 工具 `open_sql_file_manager`；该工具通过 Windows 默认 HTTPS 关联程序打开固定正式地址。附加其他文字任务时不自动打开。仅选择候选、不提交调用不会运行插件。映射不得指定 Edge、内嵌浏览器、临时 `localhost` 或 `file://` 地址。

本机插件源位于 `C:/Users/Administrator/plugins/sql-file-manager/`，由个人市场 `C:/Users/Administrator/.agents/plugins/marketplace.json` 注册。它包含固定地址、无参数 MCP 启动器和协议测试；`.mcp.json` 以 `cwd: "."`、插件相对脚本路径和绝对 Node 路径启动服务。同时以 `sql-file-manager-launcher` 注册到 Codex 全局 MCP 配置，确保桌面任务能发现启动工具。更新后须执行插件缓存刷新并在新任务中验证，避免旧任务继续使用旧工具目录。
