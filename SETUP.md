# 正式後端部署

此專案使用 GitHub Pages 作為前端、Supabase 作為教師登入／資料庫／Edge Functions，OpenAI Responses API 作為選用的動態題目服務。

## 1. 建立 Supabase 專案

1. 在 Supabase 建立專案。
2. 安裝並登入 Supabase CLI。
3. 在專案根目錄執行：

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

遷移會建立班級、學生、思考歷程、登入工作階段、AI用量、RLS權限，以及每天自動刪除第395天到期資料的排程。

## 2. 設定Google教師登入

1. 在Google Cloud Console建立OAuth Web Client。
2. Authorized redirect URI設定為：
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
3. 在Supabase Dashboard → Authentication → Providers → Google填入Client ID與Secret。
4. 在Authentication → URL Configuration加入：
   `https://sohofly.github.io/science-fair-coach/portal.html`

## 3. 部署Edge Functions

學生使用自訂代號與PIN，因此三個函式都由函式內自行驗證，不使用Supabase JWT閘道：

```sh
supabase functions deploy student-api --no-verify-jwt
supabase functions deploy recommend-topics --no-verify-jwt
supabase functions deploy purge-expired --no-verify-jwt
```

設定秘密；不要寫入GitHub：

```sh
supabase secrets set OPENAI_API_KEY=YOUR_KEY
supabase secrets set OPENAI_MODEL=gpt-5.6
supabase secrets set CRON_SECRET=A_LONG_RANDOM_SECRET
```

沒有設定`OPENAI_API_KEY`時，班級、歷程及教師功能仍可使用，學生會看到人工整理的備援題庫。

## 4. 連接公開前端

在`config.js`填入Supabase Project URL與公開anon key。anon key設計上可公開；`service_role`與OpenAI金鑰絕不可放在前端。

```js
window.SFC_CONFIG={
  supabaseUrl:'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey:'YOUR_PUBLIC_ANON_KEY'
};
```

提交並推送後，GitHub Pages會自動更新。

## 資料政策

- 0–365天：學生可繼續寫入。
- 366–395天：後端強制唯讀，教師可下載JSON、CSV或列印PDF。
- 第395天：每日排程永久刪除學生、歷程、工作階段及AI用量。
- 教師可在到期前提前永久刪除。
- 學生代號不包含姓名；PIN只保存PBKDF2雜湊。

## AI費用控制

- 每位學生每天最多5次動態問答／推薦。
- 只有動態模式呼叫OpenAI API與Web Search；備援題庫不產生API費用。
- Responses API的Web Search會產生模型與工具呼叫費用，應在OpenAI Platform設定專案預算與警示。

