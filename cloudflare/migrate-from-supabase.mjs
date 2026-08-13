import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const sourceUrl = (
  process.env.SUPABASE_URL || "https://mzdcbcpartvuwyvdunrn.supabase.co"
).replace(/\/$/, "");
const sourceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");
if (!sourceKey)
  throw new Error(
    "請設定 SUPABASE_SERVICE_ROLE_KEY（只在本機環境變數使用，不可寫入檔案）",
  );

const headers = { apikey: sourceKey, Authorization: `Bearer ${sourceKey}` };
const tables = [
  "teacher_profiles",
  "classes",
  "students",
  "research_projects",
  "thought_events",
  "research_plans",
  "research_plan_suggestions",
  "experiment_records",
  "ai_usage",
  "administrators",
  "app_settings",
];
const rows = {};
for (const table of tables) {
  const response = await fetch(`${sourceUrl}/rest/v1/${table}?select=*`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (!response.ok)
    throw new Error(
      `${table} 匯出失敗：${response.status} ${await response.text()}`,
    );
  rows[table] = await response.json();
}

const quote = (value) =>
  value == null
    ? "NULL"
    : `'${String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''")}'`;
const insert = (table, row) =>
  `INSERT OR REPLACE INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.values(row).map(quote).join(",")});`;
const sql = ["PRAGMA foreign_keys=OFF;", "BEGIN;"];
for (const item of rows.teacher_profiles)
  sql.push(
    insert("teachers", {
      id: item.user_id,
      email: item.email,
      password_hash: "migration-reset-required",
      display_name: item.display_name,
      active: item.active ? 1 : 0,
      provider: "migration-reset",
      created_at: item.created_at,
    }),
  );
for (const item of rows.classes) sql.push(insert("classes", item));
for (const item of rows.students)
  sql.push(
    insert("students", {
      id: item.id,
      class_id: item.class_id,
      student_code: item.student_code,
      login_email: item.login_email,
      display_label: item.display_label,
      password_hash: item.pin_hash,
      profile: item.profile || {},
      selected_topic: item.selected_topic,
      created_at: item.created_at,
      active_until: item.active_until,
      delete_after: item.delete_after,
    }),
  );
for (const item of rows.research_projects)
  sql.push(insert("research_projects", item));
for (const item of rows.thought_events)
  sql.push(insert("thought_events", item));
for (const item of rows.research_plans)
  sql.push(
    insert("research_plans", {
      research_id: item.research_id,
      student_id: item.student_id,
      system_plan: item.system_plan,
      current_plan: item.current_plan,
      revision: item.version || 1,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }),
  );
for (const item of rows.research_plan_suggestions)
  sql.push(
    insert("plan_suggestions", {
      id: item.id,
      research_id: item.research_id,
      student_id: item.student_id,
      teacher_id: item.teacher_id,
      comment: item.comment,
      proposed_plan: item.proposed_plan,
      status: item.status,
      created_at: item.created_at,
      decided_at: item.decided_at,
    }),
  );
for (const item of rows.experiment_records)
  sql.push(
    insert("experiment_records", {
      id: item.id,
      student_id: item.student_id,
      research_id: item.research_id,
      subtopic_id: item.subtopic_id,
      record_kind: item.record_kind,
      topic_snapshot: item.topic_snapshot,
      method: item.method,
      result: item.result,
      file_name: item.file_name,
      file_key: item.file_path,
      mime_type: item.mime_type,
      ai_review: item.ai_review,
      created_at: item.created_at,
    }),
  );
for (const item of rows.ai_usage) sql.push(insert("ai_usage", item));
for (const item of rows.administrators)
  sql.push(insert("administrators", item));
for (const item of rows.app_settings)
  sql.push(
    insert("app_settings", {
      ...item,
      value:
        typeof item.value === "string"
          ? item.value
          : JSON.stringify(item.value),
    }),
  );
sql.push("COMMIT;", "PRAGMA foreign_keys=ON;");

await mkdir(".migration", { recursive: true });
await writeFile(".migration/supabase-to-d1.sql", `${sql.join("\n")}\n`, {
  mode: 0o600,
});
await writeFile(
  ".migration/source-counts.json",
  `${JSON.stringify(Object.fromEntries(tables.map((table) => [table, rows[table].length])), null, 2)}\n`,
  { mode: 0o600 },
);
console.log(
  "來源筆數",
  Object.fromEntries(tables.map((table) => [table, rows[table].length])),
);

if (apply) {
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "science-fair-coach",
      "--remote",
      "--file",
      ".migration/supabase-to-d1.sql",
    ],
    { stdio: "inherit" },
  );
  console.log(
    "D1 資料已套用；教師密碼因 Supabase Auth 不可匯出，需由總管理者重設。附件需另行核對與搬移。",
  );
} else console.log("僅完成匯出；加上 --apply 才會寫入 D1。");
