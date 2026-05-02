const QQ_NUMBER = "3153566913";

const CATEGORY_RULES = [
  {
    name: "校园服务",
    words: ["校园", "高校", "大学", "学院", "学生", "教师", "课程", "选课", "考勤", "自习", "图书馆", "社团", "表白墙", "校友"]
  },
  {
    name: "教育学习",
    words: ["学习", "教育", "考研", "公考", "题库", "考试", "网课", "课堂", "教学", "资料", "评价", "编程", "心理评测"]
  },
  {
    name: "企业商业",
    words: ["企业", "OA", "ERP", "MES", "进销存", "仓储", "生产", "人事", "招聘", "交易", "订购", "团购", "销售", "维修", "订单", "电影", "票", "民宿", "酒店"]
  },
  {
    name: "民生服务",
    words: ["社区", "物业", "健康", "医院", "挂号", "养老", "老年", "公益", "捐赠", "资助", "救灾", "回收", "领养", "收养", "乡村", "农业"]
  },
  {
    name: "移动小程序",
    words: ["小程序", "uni-app", "APP", "微信"]
  }
];

const TECH_WORDS = [
  "Spring Boot",
  "Vue3",
  "Vue",
  "React",
  "TypeScript",
  "Element Plus",
  "Redis",
  "MySQL",
  "PostgreSQL",
  "WebSocket",
  "ECharts",
  "MyBatis-Plus",
  "MyBatis",
  "JPA",
  "PageHelper",
  "uni-app",
  "微信小程序"
];

const fallbackProjects = [
  {
    id: "001",
    title: "校园事务管理系统",
    description: "基于 Spring Boot + Vue 的校园事务管理系统",
    raw: "校园事务管理系统 基于 Spring Boot + Vue 的校园事务管理系统"
  },
  {
    id: "023",
    title: "AI智能学习助手与个性化教育平台",
    description: "个性化推荐、智能问答、学习路径等功能方向",
    raw: "AI智能学习助手与个性化教育平台 个性化推荐 智能问答 学习路径"
  },
  {
    id: "059",
    title: "制造装备物联及生产管理ERP系统",
    description: "设备管理、物联监控、生产工单、物料管理、质量检测、维保管理、数据看板",
    raw: "制造装备物联及生产管理ERP系统 SpringBoot Vue3 ERP ECharts"
  }
];

const state = {
  projects: [],
  filtered: [],
  category: "全部",
  query: "",
  visibleCount: 18
};

const elements = {
  siteHeader: document.querySelector(".site-header"),
  filterTabs: document.querySelector("#filterTabs"),
  grid: document.querySelector("#projectGrid"),
  search: document.querySelector("#projectSearch"),
  resultText: document.querySelector("#resultText"),
  loadMore: document.querySelector("#loadMore"),
  reset: document.querySelector("#resetFilters"),
  toast: document.querySelector("#toast"),
  scrollProgress: document.querySelector("#scrollProgress"),
  quickContact: document.querySelector(".quick-contact"),
  projectTotal: document.querySelector("#projectTotal"),
  hotTotal: document.querySelector("#hotTotal"),
  latestTotal: document.querySelector("#latestTotal"),
  springTotal: document.querySelector("#springTotal")
};

function cleanText(value) {
  return value
    .replace(/[🔥🌱]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseProjects(markdown) {
  const lines = markdown.split(/\r?\n/);
  const projects = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^###\s+(\d+)\s+-\s+(.+?)\s*$/);

    if (heading) {
      if (current) {
        projects.push(normalizeProject(current));
      }

      current = {
        id: heading[1],
        title: heading[2],
        description: "",
        raw: heading[2]
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const text = line.trim();
    if (!text || text.startsWith("---") || text.startsWith("**")) {
      continue;
    }

    current.description += `${current.description ? " " : ""}${text}`;
    current.raw += ` ${text}`;
  }

  if (current) {
    projects.push(normalizeProject(current));
  }

  return projects;
}

function normalizeProject(project) {
  const source = `${project.title} ${project.description}`;
  const category = pickCategory(source);
  const tags = pickTechTags(source);

  return {
    ...project,
    title: cleanText(project.title.replace(/最新/g, "")),
    description: cleanText(project.description.replace(/最新/g, "")),
    category,
    tags,
    hot: source.includes("🔥"),
    latest: source.includes("最新")
  };
}

function pickCategory(source) {
  const lowerSource = source.toLowerCase();
  const mobile = CATEGORY_RULES.find((item) => item.name === "移动小程序");

  if (mobile.words.some((word) => lowerSource.includes(word.toLowerCase()))) {
    return mobile.name;
  }

  const matched = CATEGORY_RULES
    .filter((item) => item.name !== "移动小程序")
    .map((item) => ({
      name: item.name,
      score: item.words.filter((word) => lowerSource.includes(word.toLowerCase())).length
    }))
    .sort((a, b) => b.score - a.score)[0];

  return matched && matched.score > 0 ? matched.name : "综合应用";
}

function pickTechTags(source) {
  const lowerSource = source.toLowerCase();
  const tags = TECH_WORDS.filter((word) => lowerSource.includes(word.toLowerCase()));
  return [...new Set(tags)].slice(0, 4);
}

function renderTabs() {
  const categories = ["全部", ...new Set(state.projects.map((project) => project.category))];
  elements.filterTabs.innerHTML = categories
    .map((category) => {
      const count = category === "全部" ? state.projects.length : state.projects.filter((project) => project.category === category).length;
      return `<button type="button" role="tab" aria-selected="${category === state.category}" data-category="${category}">${category} ${count}</button>`;
    })
    .join("");
}

function applyFilters() {
  const query = state.query.toLowerCase();

  state.filtered = state.projects.filter((project) => {
    const categoryMatched = state.category === "全部" || project.category === state.category;
    const queryMatched = !query || `${project.id} ${project.title} ${project.description} ${project.tags.join(" ")}`.toLowerCase().includes(query);
    return categoryMatched && queryMatched;
  });

  renderProjects();
}

function renderProjects() {
  const visible = state.filtered.slice(0, state.visibleCount);
  elements.grid.innerHTML = visible.map(renderProjectCard).join("");
  setupTiltCards(elements.grid.querySelectorAll(".project-card"));

  elements.resultText.textContent = `当前显示 ${visible.length} / ${state.filtered.length} 个项目`;
  elements.loadMore.hidden = state.visibleCount >= state.filtered.length;
}

function renderProjectCard(project) {
  const tags = project.tags.length ? project.tags : ["可定制", "管理后台"];
  const flags = [
    project.hot ? '<span class="hot">热门</span>' : "",
    project.latest ? "<span>最新</span>" : ""
  ].join("");

  return `
    <article class="project-card reveal is-visible">
      <div class="project-meta">
        <span class="project-number">#${project.id}</span>
        <span class="project-category">${project.category}</span>
      </div>
      <h3>${escapeHtml(project.title)}</h3>
      <p>${escapeHtml(project.description || "可按学校要求调整模块、角色、数据库和论文描述。")}</p>
      <div class="tag-row">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="project-flags">${flags}</div>
    </article>
  `;
}

function updateStats() {
  elements.projectTotal.textContent = state.projects.length;
  elements.hotTotal.textContent = state.projects.filter((project) => project.hot).length;
  elements.latestTotal.textContent = state.projects.filter((project) => project.latest).length;
  elements.springTotal.textContent = state.projects.filter((project) => /spring\s*boot/i.test(project.raw)).length;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[char];
  });
}

async function loadProjects() {
  try {
    const response = await fetch("readme_simple.md", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("项目库读取失败");
    }

    const markdown = await response.text();
    state.projects = parseProjects(markdown);
  } catch (error) {
    state.projects = fallbackProjects.map(normalizeProject);
    elements.resultText.textContent = "未能读取项目库，正在展示备用项目。请通过本地服务打开页面。";
  }

  state.filtered = [...state.projects];
  renderTabs();
  updateStats();
  applyFilters();
}

function bindEvents() {
  elements.filterTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button) {
      return;
    }

    state.category = button.dataset.category;
    state.visibleCount = 18;
    renderTabs();
    applyFilters();
  });

  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    state.visibleCount = 18;
    applyFilters();
  });

  elements.loadMore.addEventListener("click", () => {
    state.visibleCount += 18;
    renderProjects();
  });

  elements.reset.addEventListener("click", () => {
    state.category = "全部";
    state.query = "";
    state.visibleCount = 18;
    elements.search.value = "";
    renderTabs();
    applyFilters();
  });

  document.querySelectorAll("#copyQqTop, #copyQqBottom, #copyQqFloat").forEach((button) => {
    button.addEventListener("click", copyQq);
  });
}

async function copyQq() {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(QQ_NUMBER);
    } else {
      fallbackCopy(QQ_NUMBER);
    }
    showToast("QQ 已复制：3153566913");
  } catch (error) {
    showToast("QQ：3153566913");
  }
}

function fallbackCopy(value) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

function trackVisit() {
  if (!window.fetch) {
    return;
  }

  const payload = {
    path: `${window.location.pathname}${window.location.search}`,
    title: document.title,
    referrer: document.referrer,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screenWidth: window.screen ? window.screen.width : 0,
    screenHeight: window.screen ? window.screen.height : 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };

  fetch("/api/track", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(payload)
  }).catch(() => {
    // 静态托管时没有后端，忽略上报失败。
  });
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  items.forEach((item) => observer.observe(item));
}

function setupScrollProgress() {
  if (!elements.scrollProgress) {
    return;
  }

  const updateProgress = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const progress = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
    elements.scrollProgress.style.width = `${progress}%`;

    if (elements.quickContact) {
      elements.quickContact.classList.toggle("is-active", window.scrollY > Math.min(360, window.innerHeight * 0.42));
    }

    if (elements.siteHeader) {
      elements.siteHeader.classList.toggle("is-compact", window.scrollY > 72);
    }
  };

  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
}

function setupTiltCards(targets) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    return;
  }

  const items =
    targets ||
    document.querySelectorAll(".price-card, .project-card, .review-card, .process-item, .faq-list details");

  items.forEach((item) => {
    if (item.dataset.tiltBound) {
      return;
    }

    item.dataset.tiltBound = "true";

    item.addEventListener("pointermove", (event) => {
      const rect = item.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      item.style.setProperty("--tilt-x", `${x * 5}deg`);
      item.style.setProperty("--tilt-y", `${y * -5}deg`);
    });

    item.addEventListener("pointerleave", () => {
      item.style.setProperty("--tilt-x", "0deg");
      item.style.setProperty("--tilt-y", "0deg");
    });
  });
}

bindEvents();
setupReveal();
setupScrollProgress();
setupTiltCards();
loadProjects();
trackVisit();
