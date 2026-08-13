const enc = new TextEncoder();
const jsonParse = (v, f = null) => {
  try {
    return v == null ? f : JSON.parse(v);
  } catch {
    return f;
  }
};
const uuid = () => crypto.randomUUID();
const hex = (b) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (v) =>
  hex(await crypto.subtle.digest("SHA-256", enc.encode(v)));
const random = (chars, n) =>
  [...crypto.getRandomValues(new Uint8Array(n))]
    .map((x) => chars[x % chars.length])
    .join("");
const token = () =>
  random("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 64);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString();
const mapRow = (row, fields = []) => {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) out[f] = jsonParse(out[f], null);
  return out;
};
async function passwordHash(
  password,
  salt = random("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 16),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 210000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2-sha256$210000$${salt}$${hex(bits)}`;
}
async function passwordOK(password, stored = "") {
  if (!stored.startsWith("pbkdf2-sha256$")) {
    const [salt, want] = stored.split(":");
    if (!salt || !want) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const got = hex(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: enc.encode(salt),
          iterations: 120000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    );
    return got === want;
  }
  const [, iterations, salt, want] = stored.split("$");
  if (!iterations || !salt || !want) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const got = hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: enc.encode(salt),
        iterations: Number(iterations),
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
  return got === want;
}
function headers(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .some((x) => origin.startsWith(x.trim()));
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed
      ? origin
      : "https://sohofly.github.io",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,x-student-token,x-teacher-token,x-admin-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
const reply = (req, env, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: headers(req, env) });
async function session(env, kind, raw) {
  if (!raw) return null;
  const table = `${kind}_sessions`,
    owner =
      kind === "student"
        ? "student_id"
        : kind === "teacher"
          ? "teacher_id"
          : "administrator_id";
  return env.DB.prepare(
    `SELECT s.*,u.* FROM ${table} s JOIN ${kind === "admin" ? "administrators" : kind + "s"} u ON u.id=s.${owner} WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`,
  )
    .bind(await sha(raw))
    .first();
}
async function rate(env, key, max) {
  const hashed = await sha(key),
    since = new Date(Date.now() - 15 * 60e3).toISOString();
  const row = await env.DB.prepare(
    "SELECT count(*) n FROM login_attempts WHERE attempt_key=? AND attempted_at>?",
  )
    .bind(hashed, since)
    .first();
  if (row.n >= max) return false;
  await env.DB.prepare("INSERT INTO login_attempts(attempt_key) VALUES(?)")
    .bind(hashed)
    .run();
  return true;
}
async function createStudent(
  env,
  classId,
  email,
  password,
  source = "student",
) {
  const klass = await env.DB.prepare("SELECT * FROM classes WHERE id=?")
    .bind(classId)
    .first();
  if (!klass) throw new Error("找不到班級");
  const exists = await env.DB.prepare(
    "SELECT id FROM students WHERE lower(login_email)=lower(?) AND delete_after>CURRENT_TIMESTAMP",
  )
    .bind(email)
    .first();
  if (exists) throw new Error("這個 Email 已有學生帳號");
  const sid = uuid(),
    rid = uuid(),
    animals = [
      "藍鯨",
      "雲豹",
      "水獺",
      "山羌",
      "石虎",
      "海豚",
      "角鴞",
      "穿山甲",
    ],
    code = `${animals[crypto.getRandomValues(new Uint8Array(1))[0] % animals.length]}-${random("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4)}`,
    hash = await passwordHash(password);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO students(id,class_id,student_code,login_email,password_hash,active_until,delete_after) VALUES(?,?,?,?,?,?,?)",
    ).bind(sid, classId, code, email, hash, addDays(365), addDays(395)),
    env.DB.prepare(
      "INSERT INTO research_projects(id,student_id,title) VALUES(?,?,'第一個研究歷程')",
    ).bind(rid, sid),
    env.DB.prepare(
      "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'joined',?,'system')",
    ).bind(
      sid,
      rid,
      JSON.stringify({ class_name: klass.name, created_by: source }),
    ),
  ]);
  return {
    student: {
      id: sid,
      class_id: classId,
      student_code: code,
      login_email: email,
      class_name: klass.name,
    },
    project: { id: rid, title: "第一個研究歷程" },
  };
}
async function studentApi(req, env, body) {
  const action = body.action,
    ip = req.headers.get("CF-Connecting-IP") || "local";
  if (action === "join") {
    const email = String(body.loginEmail || "")
        .trim()
        .toLowerCase(),
      password = String(body.password || ""),
      code = String(body.classCode || "")
        .trim()
        .toUpperCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 6 ||
      password.length > 72
    )
      return reply(req, env, { error: "Email 或密碼格式不正確" }, 400);
    if (!(await rate(env, `join:${ip}:${code}`, 20)))
      return reply(req, env, { error: "建立次數過多，請15分鐘後再試" }, 429);
    const klass = await env.DB.prepare(
      "SELECT id FROM classes WHERE join_code=?",
    )
      .bind(code)
      .first();
    if (!klass) return reply(req, env, { error: "班級加入碼不存在" }, 404);
    try {
      const data = await createStudent(env, klass.id, email, password);
      const raw = token();
      await env.DB.prepare(
        "INSERT INTO student_sessions(id,student_id,token_hash,expires_at) VALUES(?,?,?,?)",
      )
        .bind(uuid(), data.student.id, await sha(raw), addDays(30))
        .run();
      return reply(req, env, { ...data, token: raw });
    } catch (e) {
      return reply(req, env, { error: e.message }, 409);
    }
  }
  if (action === "resume") {
    const email = String(body.loginEmail || "")
        .trim()
        .toLowerCase(),
      password = String(body.password || "");
    if (!(await rate(env, `resume:${ip}:${email}`, 10)))
      return reply(req, env, { error: "嘗試次數過多，請15分鐘後再試" }, 429);
    const s = await env.DB.prepare(
      "SELECT * FROM students WHERE lower(login_email)=lower(?) AND delete_after>CURRENT_TIMESTAMP",
    )
      .bind(email)
      .first();
    if (!s || !(await passwordOK(password, s.password_hash)))
      return reply(req, env, { error: "Email 或密碼不正確" }, 401);
    const raw = token();
    await env.DB.prepare(
      "INSERT INTO student_sessions(id,student_id,token_hash,expires_at) VALUES(?,?,?,?)",
    )
      .bind(uuid(), s.id, await sha(raw), addDays(30))
      .run();
    delete s.password_hash;
    return reply(req, env, {
      student: mapRow(s, ["profile", "selected_topic"]),
      token: raw,
    });
  }
  const s = await session(env, "student", req.headers.get("x-student-token"));
  if (!s) return reply(req, env, { error: "學生登入已失效" }, 401);
  if (action === "get") {
    const projects = (
      await env.DB.prepare(
        "SELECT * FROM research_projects WHERE student_id=? ORDER BY created_at DESC",
      )
        .bind(s.id)
        .all()
    ).results.map((x) => mapRow(x, ["profile", "selected_topic"]));
    const rid = String(body.researchId || projects[0]?.id || "");
    const [events, experiments, plan, suggestions] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM thought_events WHERE student_id=? AND research_id=? ORDER BY created_at",
      )
        .bind(s.id, rid)
        .all(),
      env.DB.prepare(
        "SELECT id,research_id,subtopic_id,record_kind,method,result,file_name,mime_type,ai_review,created_at FROM experiment_records WHERE student_id=? AND research_id=? ORDER BY created_at",
      )
        .bind(s.id, rid)
        .all(),
      env.DB.prepare(
        "SELECT * FROM research_plans WHERE student_id=? AND research_id=?",
      )
        .bind(s.id, rid)
        .first(),
      env.DB.prepare(
        "SELECT * FROM plan_suggestions WHERE student_id=? AND research_id=? ORDER BY created_at DESC",
      )
        .bind(s.id, rid)
        .all(),
    ]);
    const student = mapRow(s, ["profile", "selected_topic"]);
    delete student.password_hash;
    return reply(req, env, {
      student,
      projects,
      currentProject: projects.find((x) => x.id === rid) || null,
      events: events.results.map((x) => mapRow(x, ["content"])),
      experimentRecords: experiments.results,
      researchPlan: mapRow(plan, ["system_plan", "current_plan"]),
      planSuggestions: suggestions.results.map((x) =>
        mapRow(x, ["proposed_plan"]),
      ),
      status: new Date(s.active_until) <= new Date() ? "read_only" : "active",
    });
  }
  if (new Date(s.active_until) <= new Date())
    return reply(req, env, { error: "紀錄已進入唯讀期" }, 423);
  const rid = String(body.researchId || "");
  const own = rid
    ? await env.DB.prepare(
        "SELECT id FROM research_projects WHERE id=? AND student_id=?",
      )
        .bind(rid, s.id)
        .first()
    : null;
  if (action === "create_project") {
    const n = (
      await env.DB.prepare(
        "SELECT count(*) n FROM research_projects WHERE student_id=?",
      )
        .bind(s.id)
        .first()
    ).n;
    if (n >= 5)
      return reply(req, env, { error: "最多只能保存 5 個研究主題" }, 409);
    const project = {
      id: uuid(),
      title:
        String(body.title || "新研究歷程")
          .trim()
          .slice(0, 200) || "新研究歷程",
    };
    await env.DB.prepare(
      "INSERT INTO research_projects(id,student_id,title) VALUES(?,?,?)",
    )
      .bind(project.id, s.id, project.title)
      .run();
    return reply(req, env, { project });
  }
  if (!own) return reply(req, env, { error: "找不到研究歷程" }, 404);
  if (action === "event") {
    const allowed = [
      "division_selected",
      "profile_updated",
      "interest_selected",
      "observation_entered",
      "question_shown",
      "answer_submitted",
      "topics_recommended",
      "topic_selected",
      "topic_rejected",
      "source_opened",
      "plan_created",
      "reflection_added",
    ];
    if (
      !allowed.includes(body.eventType) ||
      JSON.stringify(body).length > 20000
    )
      return reply(req, env, { error: "不允許或過長的紀錄" }, 400);
    const stmts = [
      env.DB.prepare(
        "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,?,?,?)",
      ).bind(
        s.id,
        rid,
        body.eventType,
        JSON.stringify(body.content || {}),
        body.source === "system" ? "system" : "student",
      ),
    ];
    if (body.profile)
      stmts.push(
        env.DB.prepare(
          "UPDATE research_projects SET profile=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).bind(JSON.stringify(body.profile), rid),
        env.DB.prepare("UPDATE students SET profile=? WHERE id=?").bind(
          JSON.stringify(body.profile),
          s.id,
        ),
      );
    if (body.selectedTopic)
      stmts.push(
        env.DB.prepare(
          "UPDATE research_projects SET selected_topic=?,title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).bind(
          JSON.stringify(body.selectedTopic),
          String(body.selectedTopic.title || "研究歷程").slice(0, 200),
          rid,
        ),
        env.DB.prepare("UPDATE students SET selected_topic=? WHERE id=?").bind(
          JSON.stringify(body.selectedTopic),
          s.id,
        ),
      );
    await env.DB.batch(stmts);
    return reply(req, env, { ok: true });
  }
  if (action === "save_plan") {
    const value = JSON.stringify(body.plan || {});
    await env.DB.prepare(
      "INSERT INTO research_plans(research_id,student_id,system_plan,current_plan) VALUES(?,?,?,?) ON CONFLICT(research_id) DO NOTHING",
    )
      .bind(rid, s.id, value, value)
      .run();
    return reply(req, env, { ok: true });
  }
  if (action === "decide_plan_suggestion") {
    const suggestion = await env.DB.prepare(
      "SELECT * FROM plan_suggestions WHERE id=? AND student_id=? AND research_id=? AND status='pending'",
    )
      .bind(String(body.suggestionId || ""), s.id, rid)
      .first();
    if (!suggestion)
      return reply(req, env, { error: "找不到待決定的教師建議" }, 404);
    const accepted = body.decision === "accepted";
    const statements = [
      env.DB.prepare(
        "UPDATE plan_suggestions SET status=?,decided_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(accepted ? "accepted" : "rejected", suggestion.id),
      env.DB.prepare(
        "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,?,?, 'student')",
      ).bind(
        s.id,
        rid,
        accepted ? "plan_suggestion_accepted" : "plan_suggestion_rejected",
        JSON.stringify({ suggestion_id: suggestion.id }),
      ),
    ];
    if (accepted)
      statements.push(
        env.DB.prepare(
          "UPDATE research_plans SET current_plan=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE research_id=? AND student_id=?",
        ).bind(suggestion.proposed_plan, rid, s.id),
      );
    await env.DB.batch(statements);
    return reply(req, env, { ok: true, accepted });
  }
  if (action === "delete_project") {
    const n = (
      await env.DB.prepare(
        "SELECT count(*) n FROM research_projects WHERE student_id=?",
      )
        .bind(s.id)
        .first()
    ).n;
    if (n < 5)
      return reply(req, env, { error: "研究主題未滿 5 個，目前不能刪除" }, 409);
    await env.DB.prepare(
      "DELETE FROM research_projects WHERE id=? AND student_id=?",
    )
      .bind(rid, s.id)
      .run();
    const projects = (
      await env.DB.prepare(
        "SELECT * FROM research_projects WHERE student_id=? ORDER BY created_at DESC",
      )
        .bind(s.id)
        .all()
    ).results;
    return reply(req, env, {
      ok: true,
      projects,
      nextResearchId: projects[0]?.id || null,
    });
  }
  return reply(req, env, { error: "未知操作" }, 400);
}
async function adminApi(req, env, body) {
  if (body.action === "config") {
    const x = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key='teacher_google_login'",
    ).first();
    return reply(req, env, { teacherGoogleLogin: x?.value === "true" });
  }
  if (body.action === "bootstrap") {
    const n = (
      await env.DB.prepare("SELECT count(*) n FROM administrators").first()
    ).n;
    if (n) return reply(req, env, { error: "已完成初始化" }, 409);
    if (
      !env.BOOTSTRAP_TOKEN ||
      req.headers.get("Authorization") !== `Bearer ${env.BOOTSTRAP_TOKEN}`
    )
      return reply(req, env, { error: "未授權" }, 401);
    await env.DB.prepare(
      "INSERT INTO administrators(id,username,password_hash,must_change_password) VALUES(?,?,?,1)",
    )
      .bind(uuid(), "admin", await passwordHash(String(body.password || "")))
      .run();
    return reply(req, env, { ok: true });
  }
  if (body.action === "login") {
    const a = await env.DB.prepare(
      "SELECT * FROM administrators WHERE username=?",
    )
      .bind(String(body.username || ""))
      .first();
    if (!a || !(await passwordOK(String(body.password || ""), a.password_hash)))
      return reply(req, env, { error: "管理者帳號或密碼錯誤" }, 401);
    const raw = token();
    await env.DB.prepare(
      "INSERT INTO admin_sessions(id,administrator_id,token_hash,expires_at) VALUES(?,?,?,?)",
    )
      .bind(
        uuid(),
        a.id,
        await sha(raw),
        new Date(Date.now() + 8 * 3600e3).toISOString(),
      )
      .run();
    return reply(req, env, {
      token: raw,
      mustChangePassword: Boolean(a.must_change_password),
    });
  }
  const a = await session(env, "admin", req.headers.get("x-admin-token"));
  if (!a) return reply(req, env, { error: "總管理者登入已失效" }, 401);
  if (body.action === "logout") {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?")
      .bind(await sha(req.headers.get("x-admin-token")))
      .run();
    return reply(req, env, { ok: true });
  }
  if (body.action === "change_password") {
    const p = String(body.newPassword || "");
    if (p === "admin" || p.length < 10)
      return reply(
        req,
        env,
        { error: "新密碼須至少 10 個字元，且不可使用 admin" },
        400,
      );
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE administrators SET password_hash=?,must_change_password=0 WHERE id=?",
      ).bind(await passwordHash(p), a.id),
      env.DB.prepare(
        "DELETE FROM admin_sessions WHERE administrator_id=?",
      ).bind(a.id),
    ]);
    return reply(req, env, { ok: true, relogin: true });
  }
  if (a.must_change_password)
    return reply(
      req,
      env,
      { error: "請先更改預設密碼", code: "PASSWORD_CHANGE_REQUIRED" },
      403,
    );
  if (body.action === "dashboard") {
    const [teachers, classes, students, setting] = await Promise.all([
      env.DB.prepare(
        "SELECT id user_id,email,display_name,active,created_at FROM teachers ORDER BY created_at",
      ).all(),
      env.DB.prepare("SELECT * FROM classes ORDER BY created_at").all(),
      env.DB.prepare(
        "SELECT id,class_id,student_code,login_email,display_label,created_at,active_until,delete_after FROM students ORDER BY created_at",
      ).all(),
      env.DB.prepare(
        "SELECT value FROM app_settings WHERE key='teacher_google_login'",
      ).first(),
    ]);
    const projectRows = (
      await env.DB.prepare(
        "SELECT id,student_id,title,created_at FROM research_projects ORDER BY created_at",
      ).all()
    ).results;
    const tree = teachers.results.map((teacher) => ({
      ...teacher,
      active: Boolean(teacher.active),
      classes: classes.results
        .filter((klass) => klass.teacher_id === teacher.user_id)
        .map((klass) => ({
          ...klass,
          students: students.results
            .filter((student) => student.class_id === klass.id)
            .map((student) => ({
              ...student,
              research_projects: projectRows.filter(
                (project) => project.student_id === student.id,
              ),
            })),
        })),
    }));
    return reply(req, env, {
      teachers: tree,
      teacherGoogleLogin: setting?.value === "true",
    });
  }
  if (body.action === "set_google_login") {
    const value = body.enabled ? "true" : "false";
    await env.DB.prepare(
      "UPDATE app_settings SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='teacher_google_login'",
    )
      .bind(value)
      .run();
    return reply(req, env, { ok: true, enabled: body.enabled === true });
  }
  if (body.action === "create_teacher") {
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 ||
      password.length > 72
    )
      return reply(req, env, { error: "教師 Email 或密碼格式不正確" }, 400);
    try {
      const id = uuid();
      await env.DB.prepare(
        "INSERT INTO teachers(id,email,password_hash,display_name) VALUES(?,?,?,?)",
      )
        .bind(
          id,
          email,
          await passwordHash(password),
          String(body.displayName || "")
            .trim()
            .slice(0, 80) || null,
        )
        .run();
      return reply(req, env, { ok: true, teacherId: id });
    } catch {
      return reply(req, env, { error: "教師 Email 已存在" }, 409);
    }
  }
  if (body.action === "set_teacher_active") {
    await env.DB.batch([
      env.DB.prepare("UPDATE teachers SET active=? WHERE id=?").bind(
        body.active ? 1 : 0,
        String(body.teacherId || ""),
      ),
      ...(!body.active
        ? [
            env.DB.prepare(
              "DELETE FROM teacher_sessions WHERE teacher_id=?",
            ).bind(String(body.teacherId || "")),
          ]
        : []),
    ]);
    return reply(req, env, { ok: true });
  }
  if (
    body.action === "reset_teacher_password" ||
    body.action === "reset_student_password"
  ) {
    const teacher = body.action === "reset_teacher_password";
    const password = String(body.password || "");
    if (password.length < (teacher ? 8 : 6) || password.length > 72)
      return reply(req, env, { error: "新密碼長度不正確" }, 400);
    const id = String(teacher ? body.teacherId : body.studentId || "");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE ${teacher ? "teachers" : "students"} SET password_hash=? WHERE id=?`,
      ).bind(await passwordHash(password), id),
      env.DB.prepare(
        `DELETE FROM ${teacher ? "teacher" : "student"}_sessions WHERE ${teacher ? "teacher" : "student"}_id=?`,
      ).bind(id),
    ]);
    return reply(req, env, { ok: true });
  }
  if (body.action === "create_class") {
    const name = String(body.name || "").trim();
    const teacherId = String(body.teacherId || "");
    const teacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE id=? AND active=1",
    )
      .bind(teacherId)
      .first();
    if (!teacher || !name || name.length > 80)
      return reply(req, env, { error: "教師或班級名稱不正確" }, 400);
    let joinCode;
    for (let tries = 0; tries < 10; tries++) {
      const candidate = random("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
      if (
        !(await env.DB.prepare("SELECT id FROM classes WHERE join_code=?")
          .bind(candidate)
          .first())
      ) {
        joinCode = candidate;
        break;
      }
    }
    if (!joinCode)
      return reply(req, env, { error: "暫時無法產生班級加入碼" }, 500);
    const klass = {
      id: uuid(),
      teacher_id: teacherId,
      name,
      join_code: joinCode,
    };
    await env.DB.prepare(
      "INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)",
    )
      .bind(klass.id, teacherId, name, joinCode)
      .run();
    return reply(req, env, { ok: true, class: klass });
  }
  if (body.action === "create_student") {
    const email = String(body.email || "")
        .trim()
        .toLowerCase(),
      password = String(body.password || "");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 6 ||
      password.length > 72
    )
      return reply(req, env, { error: "學生 Email 或密碼格式不正確" }, 400);
    try {
      const data = await createStudent(
        env,
        String(body.classId || ""),
        email,
        password,
        "admin",
      );
      return reply(req, env, {
        ok: true,
        studentId: data.student.id,
        studentCode: data.student.student_code,
      });
    } catch (error) {
      return reply(req, env, { error: error.message }, 409);
    }
  }
  if (body.action === "student_detail") {
    const studentId = String(body.studentId || ""),
      researchId = String(body.researchId || "");
    const student = await env.DB.prepare(
      "SELECT s.id,s.student_code,s.login_email,s.display_label,s.profile,s.selected_topic,s.created_at,s.active_until,s.delete_after,c.id class_id,c.name class_name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?",
    )
      .bind(studentId)
      .first();
    if (!student) return reply(req, env, { error: "找不到學生" }, 404);
    const projects = (
      await env.DB.prepare(
        "SELECT * FROM research_projects WHERE student_id=? ORDER BY created_at DESC",
      )
        .bind(studentId)
        .all()
    ).results.map((x) => mapRow(x, ["profile", "selected_topic"]));
    if (!researchId)
      return reply(req, env, {
        student: mapRow(student, ["profile", "selected_topic"]),
        projects,
      });
    const project = projects.find((x) => x.id === researchId);
    if (!project) return reply(req, env, { error: "找不到研究主題" }, 404);
    const [events, plan, suggestions, experiments] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM thought_events WHERE student_id=? AND research_id=? ORDER BY created_at",
      )
        .bind(studentId, researchId)
        .all(),
      env.DB.prepare(
        "SELECT * FROM research_plans WHERE student_id=? AND research_id=?",
      )
        .bind(studentId, researchId)
        .first(),
      env.DB.prepare(
        "SELECT * FROM plan_suggestions WHERE student_id=? AND research_id=? ORDER BY created_at DESC",
      )
        .bind(studentId, researchId)
        .all(),
      env.DB.prepare(
        "SELECT * FROM experiment_records WHERE student_id=? AND research_id=? ORDER BY created_at",
      )
        .bind(studentId, researchId)
        .all(),
    ]);
    return reply(req, env, {
      student: mapRow(student, ["profile", "selected_topic"]),
      projects,
      currentProject: project,
      events: events.results.map((x) => mapRow(x, ["content"])),
      researchPlan: mapRow(plan, ["system_plan", "current_plan"]),
      suggestions: suggestions.results.map((x) => mapRow(x, ["proposed_plan"])),
      experimentRecords: experiments.results.map((x) =>
        mapRow(x, ["topic_snapshot", "ai_review"]),
      ),
    });
  }
  return reply(req, env, { error: "此管理操作尚未開放" }, 501);
}
async function teacherApi(req, env, body) {
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  if (body.action === "login") {
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!(await rate(env, `teacher:${ip}:${email}`, 10)))
      return reply(req, env, { error: "嘗試次數過多，請15分鐘後再試" }, 429);
    const teacher = await env.DB.prepare(
      "SELECT * FROM teachers WHERE lower(email)=lower(?)",
    )
      .bind(email)
      .first();
    if (
      !teacher ||
      !teacher.active ||
      !(await passwordOK(String(body.password || ""), teacher.password_hash))
    )
      return reply(req, env, { error: "教師帳號或密碼錯誤" }, 401);
    const raw = token();
    await env.DB.prepare(
      "INSERT INTO teacher_sessions(id,teacher_id,token_hash,expires_at) VALUES(?,?,?,?)",
    )
      .bind(uuid(), teacher.id, await sha(raw), addDays(7))
      .run();
    return reply(req, env, {
      token: raw,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        display_name: teacher.display_name,
      },
    });
  }
  const teacher = await session(
    env,
    "teacher",
    req.headers.get("x-teacher-token"),
  );
  if (!teacher || !teacher.active)
    return reply(req, env, { error: "教師登入已失效" }, 401);
  const ownsClass = async (classId) =>
    env.DB.prepare("SELECT * FROM classes WHERE id=? AND teacher_id=?")
      .bind(classId, teacher.id)
      .first();
  const ownsStudent = async (studentId) =>
    env.DB.prepare(
      "SELECT s.* FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.teacher_id=?",
    )
      .bind(studentId, teacher.id)
      .first();
  const ownsResearch = async (researchId) =>
    env.DB.prepare(
      "SELECT p.*,s.class_id FROM research_projects p JOIN students s ON s.id=p.student_id JOIN classes c ON c.id=s.class_id WHERE p.id=? AND c.teacher_id=?",
    )
      .bind(researchId, teacher.id)
      .first();
  if (body.action === "logout") {
    await env.DB.prepare("DELETE FROM teacher_sessions WHERE token_hash=?")
      .bind(await sha(req.headers.get("x-teacher-token")))
      .run();
    return reply(req, env, { ok: true });
  }
  if (body.action === "dashboard") {
    const classes = (
      await env.DB.prepare(
        "SELECT * FROM classes WHERE teacher_id=? ORDER BY created_at DESC",
      )
        .bind(teacher.id)
        .all()
    ).results;
    return reply(req, env, {
      teacher: {
        id: teacher.id,
        email: teacher.email,
        display_name: teacher.display_name,
      },
      classes,
    });
  }
  if (body.action === "create_class") {
    const name = String(body.name || "").trim();
    if (!name || name.length > 80)
      return reply(req, env, { error: "班級名稱不正確" }, 400);
    let joinCode;
    for (let i = 0; i < 10; i++) {
      const candidate = random("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
      if (
        !(await env.DB.prepare("SELECT id FROM classes WHERE join_code=?")
          .bind(candidate)
          .first())
      ) {
        joinCode = candidate;
        break;
      }
    }
    const klass = {
      id: uuid(),
      teacher_id: teacher.id,
      name,
      join_code: joinCode,
    };
    await env.DB.prepare(
      "INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)",
    )
      .bind(klass.id, klass.teacher_id, name, joinCode)
      .run();
    return reply(req, env, { ok: true, class: klass });
  }
  if (body.action === "class_detail") {
    const klass = await ownsClass(String(body.classId || ""));
    if (!klass) return reply(req, env, { error: "沒有權限查看這個班級" }, 403);
    const students = (
      await env.DB.prepare(
        "SELECT id,class_id,student_code,login_email,display_label,profile,selected_topic,created_at,active_until,delete_after FROM students WHERE class_id=? ORDER BY created_at",
      )
        .bind(klass.id)
        .all()
    ).results.map((x) => mapRow(x, ["profile", "selected_topic"]));
    return reply(req, env, { class: klass, students });
  }
  if (body.action === "create_student_account") {
    const klass = await ownsClass(String(body.classId || ""));
    if (!klass) return reply(req, env, { error: "沒有權限管理這個班級" }, 403);
    const email = String(body.loginEmail || "")
        .trim()
        .toLowerCase(),
      password = String(body.password || "");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 6 ||
      password.length > 72
    )
      return reply(req, env, { error: "學生 Email 或密碼格式不正確" }, 400);
    try {
      const data = await createStudent(
        env,
        klass.id,
        email,
        password,
        "teacher",
      );
      return reply(req, env, {
        ok: true,
        studentId: data.student.id,
        studentCode: data.student.student_code,
        loginEmail: email,
      });
    } catch (error) {
      return reply(req, env, { error: error.message }, 409);
    }
  }
  if (
    [
      "update_student_account",
      "label_student",
      "delete_student",
      "student_projects",
    ].includes(body.action)
  ) {
    const student = await ownsStudent(String(body.studentId || ""));
    if (!student)
      return reply(req, env, { error: "沒有權限管理這位學生" }, 403);
    if (body.action === "update_student_account") {
      const email = String(body.loginEmail || "")
          .trim()
          .toLowerCase(),
        password = String(body.password || "");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        (password && (password.length < 6 || password.length > 72))
      )
        return reply(req, env, { error: "Email 或密碼格式不正確" }, 400);
      const owner = await env.DB.prepare(
        "SELECT id FROM students WHERE lower(login_email)=lower(?) AND id<>? AND delete_after>CURRENT_TIMESTAMP",
      )
        .bind(email, student.id)
        .first();
      if (owner)
        return reply(req, env, { error: "這個 Email 已由其他學生使用" }, 409);
      if (password)
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE students SET login_email=?,password_hash=? WHERE id=?",
          ).bind(email, await passwordHash(password), student.id),
          env.DB.prepare(
            "DELETE FROM student_sessions WHERE student_id=?",
          ).bind(student.id),
        ]);
      else
        await env.DB.prepare("UPDATE students SET login_email=? WHERE id=?")
          .bind(email, student.id)
          .run();
      return reply(req, env, {
        ok: true,
        loginEmail: email,
        passwordChanged: Boolean(password),
      });
    }
    if (body.action === "label_student") {
      await env.DB.prepare("UPDATE students SET display_label=? WHERE id=?")
        .bind(
          String(body.label || "")
            .trim()
            .slice(0, 80) || null,
          student.id,
        )
        .run();
      return reply(req, env, { ok: true });
    }
    if (body.action === "delete_student") {
      await env.DB.prepare("DELETE FROM students WHERE id=?")
        .bind(student.id)
        .run();
      return reply(req, env, { ok: true });
    }
    const projects = (
      await env.DB.prepare(
        "SELECT * FROM research_projects WHERE student_id=? ORDER BY created_at DESC",
      )
        .bind(student.id)
        .all()
    ).results.map((x) => mapRow(x, ["profile", "selected_topic"]));
    return reply(req, env, {
      student: mapRow(student, ["profile", "selected_topic"]),
      projects,
    });
  }
  if (
    ["research_detail", "teacher_comment", "plan_suggestion"].includes(
      body.action,
    )
  ) {
    const project = await ownsResearch(String(body.researchId || ""));
    if (!project)
      return reply(req, env, { error: "沒有權限查看這個研究歷程" }, 403);
    if (body.action === "teacher_comment") {
      await env.DB.prepare(
        "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'teacher_comment',?,'teacher')",
      )
        .bind(
          project.student_id,
          project.id,
          JSON.stringify({ text: String(body.text || "").slice(0, 1000) }),
        )
        .run();
      return reply(req, env, { ok: true });
    }
    if (body.action === "plan_suggestion") {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO plan_suggestions(id,research_id,student_id,teacher_id,comment,proposed_plan) VALUES(?,?,?,?,?,?)",
        ).bind(
          uuid(),
          project.id,
          project.student_id,
          teacher.id,
          String(body.comment || "").slice(0, 2000),
          JSON.stringify(body.proposedPlan || {}),
        ),
        env.DB.prepare(
          "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'plan_suggested',?,'teacher')",
        ).bind(
          project.student_id,
          project.id,
          JSON.stringify({
            comment: body.comment,
            proposed_plan: body.proposedPlan,
          }),
        ),
      ]);
      return reply(req, env, { ok: true });
    }
    const [student, events, plan, suggestions, experiments] = await Promise.all(
      [
        env.DB.prepare(
          "SELECT id,class_id,student_code,login_email,display_label,profile,selected_topic,created_at,active_until,delete_after FROM students WHERE id=?",
        )
          .bind(project.student_id)
          .first(),
        env.DB.prepare(
          "SELECT * FROM thought_events WHERE research_id=? ORDER BY created_at",
        )
          .bind(project.id)
          .all(),
        env.DB.prepare("SELECT * FROM research_plans WHERE research_id=?")
          .bind(project.id)
          .first(),
        env.DB.prepare(
          "SELECT * FROM plan_suggestions WHERE research_id=? ORDER BY created_at DESC",
        )
          .bind(project.id)
          .all(),
        env.DB.prepare(
          "SELECT * FROM experiment_records WHERE research_id=? ORDER BY created_at",
        )
          .bind(project.id)
          .all(),
      ],
    );
    return reply(req, env, {
      student: mapRow(student, ["profile", "selected_topic"]),
      currentProject: mapRow(project, ["profile", "selected_topic"]),
      events: events.results.map((x) => mapRow(x, ["content"])),
      researchPlan: mapRow(plan, ["system_plan", "current_plan"]),
      suggestions: suggestions.results.map((x) => mapRow(x, ["proposed_plan"])),
      experimentRecords: experiments.results.map((x) =>
        mapRow(x, ["topic_snapshot", "ai_review"]),
      ),
    });
  }
  return reply(req, env, { error: "未知教師操作" }, 400);
}
async function callOpenAI(env, payload) {
  if (!env.OPENAI_API_KEY) return { error: "AI服務尚未啟用", status: 503 };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI error", response.status, data?.error?.type);
    return { error: "AI服務暫時無法回應", status: 502 };
  }
  const text =
    data.output_text ||
    data.output
      ?.flatMap((x) => x.content || [])
      .find((x) => x.type === "output_text")?.text ||
    "";
  return { data, text };
}
async function recommendApi(req, env, body) {
  const student = await session(
    env,
    "student",
    req.headers.get("x-student-token"),
  );
  if (!student) return reply(req, env, { error: "學生登入已失效" }, 401);
  if (new Date(student.active_until) <= new Date())
    return reply(req, env, { error: "紀錄已進入唯讀期" }, 423);
  const researchId = String(body.researchId || "");
  const project = await env.DB.prepare(
    "SELECT id FROM research_projects WHERE id=? AND student_id=?",
  )
    .bind(researchId, student.id)
    .first();
  if (!project) return reply(req, env, { error: "找不到研究歷程" }, 404);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const used = (
    await env.DB.prepare(
      "SELECT count(*) n FROM ai_usage WHERE student_id=? AND used_at>=?",
    )
      .bind(student.id, since.toISOString())
      .first()
  ).n;
  if (used >= 5)
    return reply(
      req,
      env,
      { error: "今天的動態題目次數已用完，仍可使用內建題庫" },
      429,
    );
  if (
    JSON.stringify(body).length > 20000 ||
    !Array.isArray(body.profile?.guidance) ||
    body.profile.guidance.length < 2
  )
    return reply(req, env, { error: "請先完成至少兩輪想法對談" }, 400);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["stage", "questions", "topics", "sources"],
    properties: {
      stage: { type: "string", enum: ["questions", "topics"] },
      questions: { type: "array", maxItems: 5, items: { type: "string" } },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "kind", "published_date"],
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            kind: { type: "string" },
            published_date: { type: "string" },
          },
        },
      },
      topics: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "division",
            "fit",
            "current_issue",
            "research_question",
            "novelty",
            "variables",
            "feasibility",
            "safety",
            "prior_works",
          ],
          properties: {
            title: { type: "string" },
            division: { type: "string" },
            fit: { type: "string" },
            current_issue: { type: "string" },
            research_question: { type: "string" },
            novelty: { type: "string" },
            variables: { type: "string" },
            feasibility: { type: "string" },
            safety: { type: "string" },
            prior_works: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "url", "relationship"],
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  relationship: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
  const prompt = `你是臺灣國小科展選題教練。學生資料：${JSON.stringify(body.profile || {})}。已完成問答：${JSON.stringify(body.answers || [])}。學生已完成至少兩輪對談，不要再提問，stage必須是topics且questions留空。搜尋近兩年可信科學議題，並優先搜尋 twsf.ntsec.gov.tw 歷屆全國科展作品。提出3至4題，說明科別、興趣、可量測問題、創新、變因、可行性及安全。不得虛構來源。`;
  const result = await callOpenAI(env, {
    model: env.OPENAI_MODEL || "gpt-5.6",
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "developer",
        content:
          "只輸出符合JSON Schema的繁體中文內容。資料不確定就明說，不得編造。",
      },
      { role: "user", content: prompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "science_fair_recommendation",
        strict: true,
        schema,
      },
    },
  });
  if (result.error)
    return reply(req, env, { error: result.error }, result.status);
  const output = jsonParse(result.text);
  if (!output) return reply(req, env, { error: "AI回傳格式不正確" }, 502);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ai_usage(student_id,model,request_id) VALUES(?,?,?)",
    ).bind(student.id, env.OPENAI_MODEL || "gpt-5.6", result.data.id || null),
    env.DB.prepare(
      "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'topics_recommended',?,'system')",
    ).bind(
      student.id,
      researchId,
      JSON.stringify({ mode: "dynamic", result: output }),
    ),
  ]);
  return reply(req, env, { result: output, requestId: result.data.id });
}
async function experimentApi(req, env, body) {
  const student = await session(
    env,
    "student",
    req.headers.get("x-student-token"),
  );
  if (!student) return reply(req, env, { error: "學生登入已失效" }, 401);
  if (new Date(student.active_until) <= new Date())
    return reply(req, env, { error: "紀錄已進入唯讀期" }, 423);
  const researchId = String(body.researchId || ""),
    project = await env.DB.prepare(
      "SELECT id FROM research_projects WHERE id=? AND student_id=?",
    )
      .bind(researchId, student.id)
      .first();
  if (!project) return reply(req, env, { error: "找不到研究歷程" }, 404);
  const kind = body.recordKind === "discussion" ? "discussion" : "experiment",
    method = String(body.method || "").trim(),
    resultText = String(body.result || "").trim();
  if (
    !method ||
    !resultText ||
    !body.topic ||
    method.length > 10000 ||
    resultText.length > 10000
  )
    return reply(req, env, { error: "實驗或討論紀錄不完整或過長" }, 400);
  let fileKey = null;
  if (body.fileData) {
    const binary = atob(String(body.fileData)),
      bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length > 8388608)
      return reply(req, env, { error: "檔案超過 8 MB" }, 413);
    const clean = String(body.fileName || "record")
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-120);
    fileKey = `${student.id}/${uuid()}-${clean}`;
    await env.FILES.put(fileKey, bytes, {
      httpMetadata: {
        contentType: String(body.mimeType || "application/octet-stream"),
      },
    });
  }
  const prompt =
    kind === "discussion"
      ? `你是臺灣國小科展教練。題目：${JSON.stringify(body.topic)}。學生問題：${resultText}。先回答問題，再提出一個具體下一步；資料不足只追問一個關鍵問題。`
      : `你是臺灣國小科展實驗教練。題目：${JSON.stringify(body.topic)}。做法：${method}。結果：${resultText}。附件名稱：${body.fileName || "無"}。檢查研究問題、變因、對照、樣本與量測，指出資料限制並給一個具體修正步驟，不可捏造附件內容。`;
  const ai = await callOpenAI(env, {
    model: env.OPENAI_MODEL || "gpt-5.6",
    reasoning: { effort: "low" },
    input: prompt,
  });
  const review =
    ai.text ||
    (kind === "discussion"
      ? "你的問題已保存。請和老師確認下一個可量測步驟。"
      : "紀錄已保存。請確認數字、單位、控制變因與重複次數。");
  const recordId = uuid();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO experiment_records(id,student_id,research_id,subtopic_id,record_kind,topic_snapshot,method,result,file_name,file_key,mime_type,ai_review) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        recordId,
        student.id,
        researchId,
        String(body.subtopicId || "").slice(0, 100) || null,
        kind,
        JSON.stringify(body.topic),
        method,
        resultText,
        body.fileName || null,
        fileKey,
        body.mimeType || null,
        JSON.stringify(review),
      ),
      env.DB.prepare(
        "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'experiment_uploaded',?,'student')",
      ).bind(
        student.id,
        researchId,
        JSON.stringify({
          record_id: recordId,
          file_name: body.fileName || null,
          method,
          result: resultText,
        }),
      ),
      env.DB.prepare(
        "INSERT INTO thought_events(student_id,research_id,event_type,content,source) VALUES(?,?,'experiment_reviewed',?,'system')",
      ).bind(
        student.id,
        researchId,
        JSON.stringify({ record_id: recordId, review }),
      ),
    ]);
  } catch (error) {
    if (fileKey) await env.FILES.delete(fileKey);
    throw error;
  }
  return reply(req, env, { recordId, review });
}
async function handle(req, env) {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: headers(req, env) });
  if (req.method !== "POST")
    return reply(req, env, { service: "science-fair-coach-api", ok: true });
  let body;
  try {
    body = await req.json();
  } catch {
    return reply(req, env, { error: "JSON 格式錯誤" }, 400);
  }
  const path = new URL(req.url).pathname;
  if (path.endsWith("/student-api")) return studentApi(req, env, body);
  if (path.endsWith("/teacher-api")) return teacherApi(req, env, body);
  if (path.endsWith("/admin-api")) return adminApi(req, env, body);
  if (path.endsWith("/recommend-topics")) return recommendApi(req, env, body);
  if (path.endsWith("/experiment-review")) return experimentApi(req, env, body);
  return reply(req, env, { error: "找不到 API" }, 404);
}
export default {
  fetch: handle,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare(
          "DELETE FROM student_sessions WHERE expires_at<=CURRENT_TIMESTAMP",
        ),
        env.DB.prepare(
          "DELETE FROM teacher_sessions WHERE expires_at<=CURRENT_TIMESTAMP",
        ),
        env.DB.prepare(
          "DELETE FROM admin_sessions WHERE expires_at<=CURRENT_TIMESTAMP",
        ),
        env.DB.prepare(
          "DELETE FROM login_attempts WHERE attempted_at<=datetime('now','-1 day')",
        ),
        env.DB.prepare(
          "DELETE FROM students WHERE delete_after<=CURRENT_TIMESTAMP",
        ),
      ]),
    );
  },
};
