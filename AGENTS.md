# SQL 文件架项目规则

## 发布渠道

记录日期：2026-10-20。来源：用户在 Cloudflare 部署会话中明确要求记住 GitHub 和 Cloudflare 两处发布。适用于 SQL 文件架项目。

- 本项目同时发布到 GitHub Pages 与 Cloudflare；以后处理功能更新和发布任务，须考虑并核对两个渠道，不能只记得其中一个。
- GitHub 仓库：`https://github.com/liuguangxu9/sql-file-shelf`。
- GitHub Pages：`https://liuguangxu9.github.io/sql-file-shelf/`。`main` 保存源码，`gh-pages` 保存构建后的静态文件；更新 main 不等于 GitHub Pages 已更新。
- Cloudflare 项目：`sql-file-shelf`；项目名自定义域名：`https://sql-file-shelf.liugx.top/`。
- Cloudflare 默认地址：`https://sql-file-shelf.liuguangxu9.workers.dev/`。
- Cloudflare 已连接该 GitHub 仓库的 `main` 分支，构建命令为 `npm run build`，部署命令为 `npx wrangler deploy --assets ./dist --name sql-file-shelf --compatibility-date 2026-10-20`。推送 main 后应检查自动构建、部署结果，不能仅凭推送成功认定 Cloudflare 已更新。
- 本项目自定义域名绑定采用 `sql-file-shelf.liugx.top`。域名整体管理事实与命名规则独立维护在 `../../60-config/domains/liugx.top.md`，不在本项目重复记录。
- Cloudflare 初始部署快照与详细记录位于 `../sql-file-shelf-cloudflare-trial/`，其 static 目录不自动跟随后续线上更新。
- 程序在两处托管，用户的本地文件不会因此上传。不同网站地址的工作区句柄和授权记录相互隔离。
- 默认打开工具的正式入口仍为 GitHub Pages；只有用户明确要求时才切换正式入口。
