(function () {
  const cfg = window.SFC_CONFIG || {};
  const tokenKey = "sfcStudentToken",
    researchKey = "sfcResearchId";
  const enabled = () => Boolean(cfg.apiUrl && localStorage.getItem(tokenKey));
  async function request(path, body) {
    const response = await fetch(`${cfg.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-student-token": localStorage.getItem(tokenKey) || "",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "後端同步失敗");
    return data;
  }
  async function call(body) {
    if (!enabled()) return null;
    return request("/student-api", body);
  }
  const researchId = () => localStorage.getItem(researchKey) || "";
  const setResearchId = (id) =>
    id
      ? localStorage.setItem(researchKey, id)
      : localStorage.removeItem(researchKey);
  async function track(eventType, content = {}, extra = {}) {
    try {
      return await call({
        action: "event",
        researchId: researchId(),
        eventType,
        content,
        ...extra,
      });
    } catch (error) {
      console.warn(error.message);
      return null;
    }
  }
  async function recommend(profile, answers = []) {
    if (!enabled()) throw new Error("尚未連接班級後端");
    return (
      await request("/recommend-topics", {
        profile,
        answers,
        researchId: researchId(),
      })
    ).result;
  }
  async function reviewExperiment(payload) {
    if (!enabled()) return null;
    return request("/experiment-review", {
      ...payload,
      researchId: researchId(),
    });
  }
  async function savePlan(plan) {
    return call({ action: "save_plan", researchId: researchId(), plan });
  }
  async function decideSuggestion(suggestionId, decision) {
    return call({ action: "decide_plan_suggestion", suggestionId, decision });
  }
  async function saveReflection(reflection) {
    return call({
      action: "event",
      researchId: researchId(),
      eventType: "reflection_added",
      content: reflection,
    });
  }
  async function createProject(title) {
    const data = await call({ action: "create_project", title });
    setResearchId(data.project.id);
    return data.project;
  }
  async function deleteProject(id) {
    return call({ action: "delete_project", researchId: id });
  }
  async function teacher() {
    return localStorage.getItem("sfcTeacherToken") ? { role: "teacher" } : null;
  }
  async function logout() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(researchKey);
  }
  window.ScienceFairBackend = {
    enabled,
    teacher,
    track,
    recommend,
    reviewExperiment,
    savePlan,
    decideSuggestion,
    saveReflection,
    createProject,
    deleteProject,
    get: (id = researchId()) => call({ action: "get", researchId: id }),
    setResearchId,
    researchId,
    setToken: (token) => localStorage.setItem(tokenKey, token),
    logout,
    clear: () => {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(researchKey);
    },
  };
})();
