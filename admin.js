const cfg = window.SFC_CONFIG || {},
  root = document.querySelector("#admin"),
  actions = document.querySelector("#admin-actions"),
  statusText = document.querySelector("#admin-status");
const tokenKey = "sfcAdminToken";
let token = localStorage.getItem(tokenKey) || "";
const esc = (v = "") =>
  String(v).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const message = (text, type = "error") =>
  `<p class="status-${type}">${esc(text)}</p>`;
async function api(body) {
  const response = await fetch(`${cfg.apiUrl}/admin-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "操作失敗");
    error.code = data.code;
    throw error;
  }
  return data;
}
function login() {
  actions.innerHTML = "";
  statusText.textContent = "（總管理者未登入）";
  root.innerHTML = `<section class="panel"><div class="eyebrow">系統管理</div><h1>總管理者登入</h1><div class="danger-note">首次登入帳號與密碼皆為 <strong>admin</strong>。系統會要求立刻更換密碼，請勿繼續使用預設密碼。</div><form class="portal-form" id="admin-login"><label>帳號<input name="username" required autocomplete="username"></label><label>密碼<input name="password" type="password" required autocomplete="current-password"></label><button class="primary">登入</button></form><div id="result"></div></section>`;
  document.querySelector("#admin-login").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      out = document.querySelector("#result");
    try {
      const data = await api({
        action: "login",
        username: f.get("username"),
        password: f.get("password"),
      });
      token = data.token;
      localStorage.setItem(tokenKey, token);
      data.mustChangePassword ? changePassword(true) : dashboard();
    } catch (error) {
      out.innerHTML = message(error.message);
    }
  };
}
function changePassword(required = false) {
  actions.innerHTML = "";
  root.innerHTML = `<section class="panel"><div class="eyebrow">帳號安全</div><h2>${required ? "首次登入，請更改預設密碼" : "更改總管理者密碼"}</h2><p>新密碼須為 10 至 72 個字元，不可使用 admin。更改後需重新登入。</p><form class="portal-form" id="change-password"><label>新密碼<input name="password" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><label>再次輸入新密碼<input name="confirm" type="password" minlength="10" maxlength="72" required autocomplete="new-password"></label><button class="primary">儲存新密碼</button>${required ? "" : '<button type="button" class="secondary" data-cancel>取消</button>'}</form><div id="result"></div></section>`;
  document.querySelector("[data-cancel]")?.addEventListener("click", dashboard);
  document.querySelector("#change-password").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      out = document.querySelector("#result"),
      password = String(f.get("password") || "");
    if (password !== f.get("confirm")) {
      out.innerHTML = message("兩次輸入的密碼不一致");
      return;
    }
    try {
      await api({ action: "change_password", newPassword: password });
      token = "";
      localStorage.removeItem(tokenKey);
      alert("密碼已更改，請使用新密碼重新登入。");
      login();
    } catch (error) {
      out.innerHTML = message(error.message);
    }
  };
}
async function logout() {
  try {
    await api({ action: "logout" });
  } catch {}
  token = "";
  localStorage.removeItem(tokenKey);
  login();
}
async function dashboard() {
  try {
    const data = await api({ action: "dashboard" }),
      teachers = data.teachers || [],
      classes = teachers.flatMap((t) => t.classes || []),
      students = classes.flatMap((c) => c.students || []);
    statusText.textContent = "（總管理者已登入）";
    actions.innerHTML =
      '<button class="soft" id="change">更改密碼</button> <button class="soft" id="logout">登出</button>';
    root.innerHTML = `<section class="panel"><div class="dashboard-head"><div><div class="eyebrow">全站資料</div><h1>總管理控制台</h1></div><button class="primary" id="add-teacher">＋ 新增教師</button></div><div class="admin-grid"><div class="metric"><strong>${teachers.length}</strong>位教師</div><div class="metric"><strong>${classes.length}</strong>個班級</div><div class="metric"><strong>${students.length}</strong>位學生</div></div><div class="setting-row"><div><h3>允許教師直接使用 Google 登入</h3><p>預設關閉。關閉時，只有資料庫中已註冊的教師能登入。</p></div><label><input type="checkbox" id="google-toggle" ${data.teacherGoogleLogin ? "checked" : ""}> ${data.teacherGoogleLogin ? "已開啟" : "已關閉"}</label></div><section><h2>所有教師、班級與學生</h2>${teachers.map(teacherCard).join("") || "<p>尚未建立教師。</p>"}</section></section>`;
    document.querySelector("#change").onclick = () => changePassword(false);
    document.querySelector("#logout").onclick = logout;
    document.querySelector("#add-teacher").onclick = createTeacher;
    document.querySelector("#google-toggle").onchange = async (e) => {
      try {
        await api({ action: "set_google_login", enabled: e.target.checked });
        dashboard();
      } catch (error) {
        alert(error.message);
        dashboard();
      }
    };
    document.querySelectorAll("[data-toggle-teacher]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !confirm(
              `確定要${b.dataset.active === "true" ? "停用" : "啟用"}這位教師？`,
            )
          )
            return;
          try {
            await api({
              action: "set_teacher_active",
              teacherId: b.dataset.toggleTeacher,
              active: b.dataset.active !== "true",
            });
            dashboard();
          } catch (error) {
            alert(error.message);
          }
        }),
    );
    document
      .querySelectorAll("[data-add-class]")
      .forEach((b) => (b.onclick = () => createClass(b.dataset.addClass)));
    document
      .querySelectorAll("[data-add-student]")
      .forEach((b) => (b.onclick = () => createStudent(b.dataset.addStudent)));
    document
      .querySelectorAll("[data-view-student]")
      .forEach(
        (b) => (b.onclick = () => studentProjects(b.dataset.viewStudent)),
      );
  } catch (error) {
    if (error.code === "PASSWORD_CHANGE_REQUIRED") return changePassword(true);
    token = "";
    localStorage.removeItem(tokenKey);
    login();
    root.insertAdjacentHTML("afterbegin", message(error.message));
  }
}
function teacherCard(t) {
  const classes = t.classes || [];
  return `<details class="teacher-card"><summary><span>${esc(t.display_name || t.email)}<br><small>${esc(t.email)}｜${t.active ? "使用中" : "已停用"}</small></span><span>${classes.length} 班／${classes.flatMap((c) => c.students || []).length} 人</span></summary><div class="admin-actions"><button class="secondary" data-add-class="${t.user_id}" ${t.active ? "" : "disabled"}>新增此教師的班級</button><button class="secondary" data-reset-teacher="${t.user_id}" data-name="${esc(t.display_name || t.email)}">更改教師密碼</button><button class="${t.active ? "danger" : "secondary"}" data-toggle-teacher="${t.user_id}" data-active="${t.active}">${t.active ? "停用教師" : "重新啟用"}</button></div>${classes.map((c) => `<div class="class-admin"><h3>${esc(c.name)}</h3><p>加入碼：<span class="join-code">${esc(c.join_code)}</span></p><button class="secondary" data-add-student="${c.id}">新增此班學生</button>${(c.students || []).map((s) => `<div class="student-mini"><div><strong>${esc(s.display_label || s.student_code)}</strong>｜${esc(s.login_email || "未設定 Email")}<br><small>建立於 ${new Date(s.created_at).toLocaleString("zh-TW")}｜研究主題：${(s.research_projects || []).map((p) => esc(p.title)).join("、") || "尚無"}</small></div><div class="admin-actions"><button class="secondary" data-reset-student="${s.id}" data-name="${esc(s.display_label || s.student_code)}">更改學生密碼</button><button class="secondary" data-view-student="${s.id}">查看學習歷程與心得</button></div></div>`).join("") || "<p>尚無學生。</p>"}</div>`).join("") || "<p>尚無班級。</p>"}</details>`;
}
const eventNames = {
  joined: "加入班級",
  division_selected: "選擇科別",
  profile_updated: "更新條件",
  interest_selected: "選擇興趣",
  observation_entered: "生活觀察",
  question_shown: "系統提問",
  answer_submitted: "學生回答",
  topics_recommended: "推薦題目",
  topic_selected: "選擇題目",
  topic_rejected: "排除題目",
  source_opened: "查閱資料",
  teacher_comment: "教師留言",
  plan_created: "建立研究架構",
  plan_suggested: "教師提出架構建議",
  plan_suggestion_accepted: "學生採用教師建議",
  plan_suggestion_declined: "學生暫不採用教師建議",
  experiment_uploaded: "上傳實驗紀錄",
  experiment_reviewed: "實驗分析回饋",
  reflection_added: "學生心得歷程",
  exported: "匯出",
};
const planFields = [
  ["question", "研究問題"],
  ["hypothesis", "研究假設"],
  ["variables", "變因設計"],
  ["materials", "材料與工具"],
  ["procedure", "建議步驟"],
  ["analysis", "資料整理與判讀"],
  ["safety", "安全檢查"],
];
function valueText(value) {
  if (value === null || value === undefined || value === "") return "尚未填寫";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(valueText).join("、");
  return Object.entries(value)
    .map(([key, item]) => `${key}：${valueText(item)}`)
    .join("\n");
}
function compact(values, fallback = "尚無紀錄") {
  const text = values
    .flatMap((x) => (Array.isArray(x) ? x : [x]))
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean);
  return text.length ? text.slice(0, 3).join("；") : fallback;
}
function thinkingSummary(student, events, researchPlan, suggestions) {
  const profile = student.profile || {},
    guidance = profile.guidance || [],
    plan = researchPlan?.current_plan || {},
    of = (type) => events.filter((e) => e.event_type === type),
    contents = (type) => of(type).map((e) => e.content || {}),
    answers = contents("answer_submitted"),
    experiments = contents("experiment_uploaded"),
    sources = contents("source_opened"),
    comments = contents("teacher_comment"),
    decisions = events.filter((e) =>
      ["plan_suggestion_accepted", "plan_suggestion_declined"].includes(
        e.event_type,
      ),
    );
  const questions = compact([
      ...guidance.map((x) => x.question),
      ...answers.map((x) => x.question),
      ...comments.map((x) => x.text),
    ]),
    observation =
      profile.observation || contents("observation_entered")[0]?.text,
    original = compact([observation, guidance[0]?.answer, answers[0]?.answer]),
    laterAnswers = compact([
      ...guidance.slice(1).map((x) => x.answer),
      ...answers.slice(1).map((x) => x.answer),
    ]),
    experimentEvidence = compact(experiments.map((x) => x.result)),
    sourceEvidence = compact(sources.map((x) => x.title)),
    decisionText = compact(
      decisions.map((e) =>
        e.event_type === "plan_suggestion_accepted"
          ? `採用教師建議：${e.content?.comment || ""}`
          : `未採用教師建議：${e.content?.comment || ""}`,
      ),
    ),
    planChange = (suggestions || []).some((x) => x.status === "accepted")
      ? "學生採用教師建議後，研究架構已產生新版。"
      : decisionText;
  const cards = [
    {
      title: "發現問題",
      skills: "觀察・提問・好奇心",
      original,
      question: questions,
      evidence: compact([observation, guidance[0]?.answer, answers[0]?.answer]),
      change:
        guidance.length > 1 || answers.length > 1
          ? `後續聚焦為：${laterAnswers}`
          : "尚未看到從觀察收斂成研究問題的變化。",
      followup:
        observation && (guidance.length >= 2 || answers.length >= 2)
          ? ""
          : "請學生說明：從原始觀察中，最後最想研究的是哪一個可以測量的問題？",
    },
    {
      title: "拆解問題",
      skills: "分析・比較・分類・抽象化・變因辨識",
      original: compact(
        [guidance[1]?.answer, answers[1]?.answer, plan.question],
        original,
      ),
      question: compact([
        guidance[2]?.question,
        answers[2]?.question,
        "哪些因素可能影響結果？實驗中只改變哪一項？",
      ]),
      evidence: compact([plan.variables, plan.hypothesis, laterAnswers]),
      change: plan.variables
        ? "想法已整理成研究假設與操縱、應變及控制變因。"
        : "尚未形成清楚的變因關係。",
      followup:
        plan.variables && plan.hypothesis
          ? ""
          : "請學生區分：想改變什麼、要測量什麼，以及哪些條件必須保持相同？",
    },
    {
      title: "用證據判斷",
      skills: "資料分析・來源查證・批判思考・替代解釋",
      original: compact([
        plan.hypothesis,
        guidance[1]?.answer,
        answers[1]?.answer,
      ]),
      question: compact([
        comments.map((x) => x.text),
        plan.analysis,
        "結果是否支持原先假設？還有沒有其他可能解釋？",
      ]),
      evidence: compact([experimentEvidence, sourceEvidence]),
      change: experiments.length
        ? `學生已取得結果；下一步需比較結果與原假設。${plan.analysis ? `目前分析方式：${plan.analysis}` : ""}`
        : "尚無實驗結果可用來檢驗原先想法。",
      followup:
        experiments.length && plan.analysis
          ? ""
          : "請學生提供可核對的數字、單位或觀察紀錄，並說明結果是否支持假設及可能的其他解釋。",
    },
    {
      title: "反思與負責",
      skills: "想法修正・價值判斷・安全倫理・研究自主性",
      original: compact([
        plan.safety,
        profile.selectedTopic?.safety,
        student.selected_topic?.safety,
      ]),
      question: compact([
        comments.map((x) => x.text),
        (suggestions || []).map((x) => x.comment),
        "這個做法安全、公平且合適嗎？你為什麼接受或不接受修改？",
      ]),
      evidence: compact([plan.safety, decisionText]),
      change: planChange,
      followup:
        plan.safety && decisions.length
          ? ""
          : "請學生說明安全、倫理或環境影響，並留下接受或不接受修改建議的理由。",
    },
  ];
  return cards.map((card) => ({
    ...card,
    status: card.followup ? "需要追問" : "證據充足",
    followup: card.followup || "證據充足",
  }));
}
function thinkingCards(cards) {
  return `<section class="thinking-section"><div class="thinking-head"><div><div class="eyebrow">高層次思考能力</div><h3>四個主類別的思考證據鏈</h3></div><p>依學生目前紀錄自動整理；「證據充足」表示現階段不需追加問題，不代表能力評分。</p></div><div class="thinking-grid">${cards.map((c) => `<article class="thinking-card"><header><div><h4>${esc(c.title)}</h4><small>${esc(c.skills)}</small></div><span class="thinking-status ${c.status === "證據充足" ? "enough" : "followup"}">${c.status}</span></header><ol class="evidence-chain"><li><strong>學生的原始想法</strong><p>${esc(c.original)}</p></li><li><strong>教師或系統提問</strong><p>${esc(c.question)}</p></li><li><strong>學生提供的證據</strong><p>${esc(c.evidence)}</p></li><li><strong>想法如何改變</strong><p>${esc(c.change)}</p></li><li class="next-question"><strong>目前仍需追問之處</strong><p>${esc(c.followup)}</p></li></ol></article>`).join("")}</div></section>`;
}
function reflectionCards(events) {
  const items = events.filter((e) => e.event_type === "reflection_added");
  return `<section class="teacher-reflections"><h3>學生心得歷程（${items.length} 筆）</h3>${
    items
      .slice()
      .reverse()
      .map(
        (e) =>
          `<article class="reflection-card"><time>${esc(e.content?.date || new Date(e.created_at).toLocaleDateString("zh-TW"))}</time><h3>我學到了什麼</h3><p>${esc(e.content?.learned || "")}</p><h3>我覺得比較困難的地方</h3><p>${esc(e.content?.difficult || "")}</p></article>`,
      )
      .join("") || '<div class="notice">這個研究歷程尚無學生心得。</div>'
  }</section>`;
}
async function studentProjects(studentId) {
  try {
    const data = await api({ action: "student_detail", studentId }),
      label = data.student.display_label || data.student.student_code;
    root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回總管理控制台</button><div class="eyebrow">學生資料</div><h1>${esc(label)} 的研究主題</h1><p>${esc(data.student.login_email || "未設定 Email")}｜共 ${(data.projects || []).length} 個研究主題</p>${(data.projects || []).map((p) => `<article class="student-row"><div><h3>${esc(p.title)}</h3><p>建立於 ${new Date(p.created_at).toLocaleString("zh-TW")}</p></div><button class="primary" data-research="${p.id}">查看學習歷程與心得</button></article>`).join("") || '<div class="notice">這位學生尚無研究主題。</div>'}</section>`;
    document.querySelector("[data-back]").onclick = dashboard;
    document
      .querySelectorAll("[data-research]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            studentHistory(studentId, b.dataset.research, label)),
      );
  } catch (error) {
    root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回總管理控制台</button>${message(error.message)}</section>`;
    document.querySelector("[data-back]").onclick = dashboard;
  }
}
async function studentHistory(studentId, researchId, label) {
  try {
    const data = await api({ action: "student_detail", studentId, researchId }),
      events = data.events || [];
    data.student.profile =
      data.currentProject.profile || data.student.profile || {};
    data.student.selected_topic =
      data.currentProject.selected_topic || data.student.selected_topic || null;
    const cards = thinkingSummary(
      data.student,
      events,
      data.researchPlan,
      data.suggestions || [],
    );
    root.innerHTML = `<section class="panel"><div class="admin-history-nav"><button class="secondary" id="back-dashboard">← 返回總管理控制台</button><button class="secondary" id="back-student">← 返回 ${esc(label)} 的主題列表</button></div><div class="topic-context"><div class="eyebrow">目前查看的研究主題</div><h2>${esc(data.currentProject.title)}</h2><p>${esc(label)}｜總管理者唯讀檢視；呈現內容與指導教師的思考歷程頁一致。</p></div><div class="dashboard-head"><div><div class="eyebrow">學生思考歷程</div><h2>${esc(label)}</h2></div><button class="primary" onclick="window.print()">PDF</button></div>${thinkingCards(cards)}${reflectionCards(events)}${readOnlyPlan(data.researchPlan, data.suggestions || [])}${experimentSection(data.experimentRecords || [])}<details class="raw-timeline"><summary>查看完整原始事件時間軸（${events.length} 筆）</summary><div>${events.map((e) => `<article class="event"><strong>${esc(eventNames[e.event_type] || e.event_type)}</strong><br><time>${new Date(e.created_at).toLocaleString("zh-TW")}｜${esc(e.source)}</time><pre>${esc(JSON.stringify(e.content, null, 2))}</pre></article>`).join("") || "<p>尚無歷程。</p>"}</div></details></section>`;
    document.querySelector("#back-dashboard").onclick = dashboard;
    document.querySelector("#back-student").onclick = () =>
      studentProjects(studentId);
  } catch (error) {
    alert(error.message);
    studentProjects(studentId);
  }
}
function readOnlyPlan(plan, suggestions) {
  if (!plan?.current_plan)
    return '<div class="notice">學生確認題目並建立研究架構後，這裡會顯示研究架構與教師建議。</div>';
  return `<section class="teacher-plan"><h3>目前研究架構</h3><div class="portal-form read-only-plan">${planFields.map(([key, label]) => `<label>${label}<textarea rows="5" readonly>${esc(plan.current_plan[key] || "")}</textarea></label>`).join("")}</div><div class="suggestion-history"><h3>教師建議紀錄</h3>${suggestions.map((s) => `<p><strong>${s.status === "pending" ? "等待學生決定" : s.status === "accepted" ? "學生已採用" : "學生未採用"}</strong>｜${new Date(s.created_at).toLocaleString("zh-TW")}<br>${esc(s.comment)}</p>`).join("") || "<p>尚未提出建議。</p>"}</div></section>`;
}
function planSection(plan) {
  if (!plan?.current_plan)
    return '<section><h2>研究架構</h2><div class="notice">尚未建立研究架構。</div></section>';
  return `<section><h2>研究架構</h2><article class="history-card plan-grid">${Object.entries(
    plan.current_plan,
  )
    .map(
      ([key, value]) =>
        `<div><strong>${esc(key)}</strong><p>${esc(valueText(value))}</p></div>`,
    )
    .join("")}</article></section>`;
}
function experimentSection(records = []) {
  return `<section><h2>實驗與討論紀錄（${records.length} 筆）</h2>${records.map((r) => `<article class="history-card"><time>${new Date(r.created_at).toLocaleString("zh-TW")}</time><h3>${r.record_kind === "discussion" ? "討論紀錄" : "實驗紀錄"}</h3><p><strong>做法／問題</strong><br>${esc(r.method || "尚未填寫")}</p><p><strong>結果／想法</strong><br>${esc(r.result || "尚未填寫")}</p>${r.ai_review ? `<p><strong>AI 回饋</strong><br>${esc(valueText(r.ai_review))}</p>` : ""}</article>`).join("") || '<div class="notice">這個主題尚無實驗或討論紀錄。</div>'}</section>`;
}
function createTeacher() {
  root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回控制台</button><h2>新增教師</h2><form class="portal-form" id="teacher-form"><label>教師姓名<input name="displayName" maxlength="80"></label><label>教師 Email<input name="email" type="email" required></label><label>初始密碼（8 至 72 個字元）<input name="password" type="password" minlength="8" maxlength="72" required></label><button class="primary">建立教師帳號</button></form><div id="result"></div></section>`;
  document.querySelector("[data-back]").onclick = dashboard;
  document.querySelector("#teacher-form").onsubmit = async (e) =>
    submit(e, { action: "create_teacher" }, "教師帳號已建立");
}
function createClass(teacherId) {
  root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回控制台</button><h2>新增教師班級</h2><form class="portal-form" id="class-form"><label>班級名稱<input name="name" maxlength="80" required></label><button class="primary">建立班級</button></form><div id="result"></div></section>`;
  document.querySelector("[data-back]").onclick = dashboard;
  document.querySelector("#class-form").onsubmit = async (e) =>
    submit(e, { action: "create_class", teacherId }, "班級已建立");
}
function createStudent(classId) {
  root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回控制台</button><h2>新增學生</h2><form class="portal-form" id="student-form"><label>學生 Email<input name="email" type="email" required></label><label>初始密碼（6 至 72 個字元）<input name="password" type="password" minlength="6" maxlength="72" required></label><button class="primary">建立學生帳號</button></form><div id="result"></div></section>`;
  document.querySelector("[data-back]").onclick = dashboard;
  document.querySelector("#student-form").onsubmit = async (e) =>
    submit(e, { action: "create_student", classId }, "學生帳號已建立");
}
function resetAccountPassword(kind, id, name) {
  const teacher = kind === "teacher",
    minimum = teacher ? 8 : 6;
  root.innerHTML = `<section class="panel"><button class="secondary" data-back>← 返回控制台</button><div class="eyebrow">帳號安全</div><h2>更改${teacher ? "教師" : "學生"}密碼</h2><p>帳號：${esc(name)}。系統無法查看原密碼，只能設定新密碼。</p><form class="portal-form" id="reset-account-password"><label>新密碼（${minimum} 至 72 個字元）<input name="password" type="password" minlength="${minimum}" maxlength="72" required autocomplete="new-password"></label><label>再次輸入新密碼<input name="confirm" type="password" minlength="${minimum}" maxlength="72" required autocomplete="new-password"></label><button class="primary">儲存新密碼</button></form><div id="result"></div></section>`;
  document.querySelector("[data-back]").onclick = dashboard;
  document.querySelector("#reset-account-password").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target),
      password = String(form.get("password") || ""),
      out = document.querySelector("#result");
    if (password !== form.get("confirm")) {
      out.innerHTML = message("兩次輸入的新密碼不一致");
      return;
    }
    if (!confirm(`確定要重設 ${name} 的密碼？`)) return;
    try {
      await api({
        action: teacher ? "reset_teacher_password" : "reset_student_password",
        [teacher ? "teacherId" : "studentId"]: id,
        password,
      });
      out.innerHTML = message(
        "新密碼已設定。請通知使用者以新密碼登入。",
        "success",
      );
      setTimeout(dashboard, 1000);
    } catch (error) {
      out.innerHTML = message(error.message);
    }
  };
}
async function submit(event, base, success) {
  event.preventDefault();
  const out = document.querySelector("#result"),
    values = Object.fromEntries(new FormData(event.target));
  try {
    await api({ ...base, ...values });
    out.innerHTML = message(success, "success");
    setTimeout(dashboard, 700);
  } catch (error) {
    out.innerHTML = message(error.message);
  }
}
root.addEventListener("click", (event) => {
  const teacherButton = event.target.closest("[data-reset-teacher]"),
    studentButton = event.target.closest("[data-reset-student]");
  if (teacherButton)
    resetAccountPassword(
      "teacher",
      teacherButton.dataset.resetTeacher,
      teacherButton.dataset.name,
    );
  if (studentButton)
    resetAccountPassword(
      "student",
      studentButton.dataset.resetStudent,
      studentButton.dataset.name,
    );
});
token ? dashboard() : login();
