# 毕设服务官网 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建一个突出价格、专业度、项目经验和闲鱼付款信任感的静态官网。

**Architecture:** 使用无构建静态站点，`index.html` 承载页面结构，`styles.css` 负责视觉与响应式，`script.js` 从 `readme_simple.md` 解析项目清单并生成分类作品墙。这样后续只更新 Markdown 项目库即可同步展示。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、本地静态 HTTP 服务验证。

---

### Task 1: 页面结构

**Files:**
- Create: `index.html`

**Steps:**
1. 创建顶部导航、首屏报价、分项价格、流程、项目库、客户反馈、付款说明和 FAQ 区块。
2. 为关键区域添加稳定锚点：`#pricing`、`#projects`、`#reviews`、`#faq`。
3. 放置项目库筛选按钮、搜索框、项目列表容器和加载更多按钮。

### Task 2: 视觉样式

**Files:**
- Create: `styles.css`

**Steps:**
1. 定义暗色专业主题、亮色价格锚点、响应式栅格和交互动效。
2. 适配桌面、平板和手机视口。
3. 添加 `prefers-reduced-motion` 兼容。

### Task 3: 项目库逻辑

**Files:**
- Create: `script.js`

**Steps:**
1. 读取 `readme_simple.md` 并解析 `### 编号 - 标题` 格式。
2. 根据关键词自动分类为校园服务、教育学习、企业商业、民生服务、移动小程序、综合应用。
3. 实现搜索、筛选、统计数量、复制 QQ、滚动入场效果。

### Task 4: 验证

**Commands:**
- `python -m http.server 4173`
- 浏览器访问 `http://localhost:4173`

**Expected:**
- 首页可打开，价格第一屏可见。
- 项目总数从 `readme_simple.md` 自动解析。
- 搜索和分类筛选正常工作。
