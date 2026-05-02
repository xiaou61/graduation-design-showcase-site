# 毕设展示网站

这是一个毕业设计服务展示网站，现在包含 Node 后端、访问统计上报和后台管理页。

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

然后访问：

- 前台：`http://localhost:3000`
- 后台：`http://localhost:3000/admin`

后台账号通过环境变量配置：

```env
ADMIN_USERNAME=yuanfang
ADMIN_PASSWORD=你的后台密码
```

本地 `.env` 不会提交到 GitHub。部署到 Render、Railway、VPS 等 Node 服务时，需要在平台环境变量里设置同样的账号密码。GitHub Pages 只能托管静态文件，不能运行这个后端。

## 后台能力

- 记录访问时间、访客 Cookie、真实 IP、地区、设备、浏览器、来源页
- 按今天、7 天、30 天、90 天、全部统计访问量、访客数和独立 IP
- 展示地区排行、页面排行、设备统计和最近访问明细
- 后台使用 httpOnly Cookie 登录态，并对登录和访问上报做基础限流

## 文件说明

- `server.js`：Node/Express 后端入口，负责静态托管、访问记录、后台鉴权和统计 API
- `admin.html`、`admin.css`、`admin.js`：访问统计后台
- `admin-login.html`、`login.js`：后台登录页
- `index.html`：前台页面结构
- `styles.css`：前台视觉样式与响应式布局
- `script.js`：项目库解析、筛选、搜索、前台交互和访问上报
- `readme_simple.md`：项目案例数据源
- `data/`：运行时访问日志与 IP 缓存目录，不提交到仓库
- `verification/`：页面验证截图
