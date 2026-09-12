# SQL 文件架

一个面向 Microsoft Edge 的本地优先 PWA，用来浏览和编辑用户显式授权目录中的 `.sql`、`.txt` 与 `.md` 文件。

## 核心保证

- 所有文件读写都在浏览器本机完成，不上传文件内容。
- 可保存多个已授权工作区，像 SQLShelf 一样在左栏分组浏览；移除工作区只会删除授权记录，不会删除本地文件。
- 保存沿用文件的原编码、BOM 与换行符；若编辑内容无法由原编码表示，工具会阻止覆盖并建议另存为 UTF-8。
- 文件编码以 BOM 和严格 UTF-8 校验优先识别；无 BOM 的遗留编码为概率推断，界面会显示置信度并允许改选。
- 写回前会完成“编码 → 解码 → 文本逐字比较”的无损校验，并创建同目录 `.bak` 备份。

## 开发与构建

```powershell
npm install
npm test
npm run build
npm run serve
```

在 Edge 中打开 `http://localhost:4173` 后，选择工作目录。生产使用应部署 `dist/` 到固定 HTTPS 地址，再从 Edge 的地址栏安装为应用。

GitHub Pages 采用 `gh-pages` 发布分支：`main` 保存源码，`gh-pages` 只保存构建后的静态文件。这样不需要为 GitHub CLI 授予 Actions 工作流权限。

## 文件

- `src/codec.js`：字节级编码识别、转换与保存校验。
- `src/app.js`：文件系统授权、浏览和界面交互。
- `tests/codec.test.js`：编码不变与不可表示字符的回归测试。

## 已知边界

无 BOM 的纯 ASCII 或单字节文本可能在多种编码中等价，任何识别器都无法保证唯一正确答案；本工具将其标注为低置信度，而不会把推断当作事实。
