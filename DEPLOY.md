# Деплой VoiceTask на Vercel

## 1. Подготовка Supabase

### 1.1. Включить realtime для таблиц

В Supabase Dashboard → **Database → Replication**:
- Включить replication для `notifications` (для realtime-уведомлений)
- Включить replication для `tasks` (для обновлений задач в TasksPage)

### 1.2. Получить ключи

В **Project Settings → API** скопируй:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` ключ → `VITE_SUPABASE_ANON_KEY`
- `service_role` ключ → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **только серверный — никогда не в frontend**

### 1.3. RLS политики (если ещё не настроены)

Минимальные политики для работы приложения:

```sql
-- profiles: каждый видит всех
create policy "profiles_select_all" on profiles for select using (true);

-- projects: видят все авторизованные, создаёт/редактирует владелец
create policy "projects_select_all"  on projects for select using (auth.role() = 'authenticated');
create policy "projects_insert_own"  on projects for insert with check (owner_id = auth.uid());
create policy "projects_update_own"  on projects for update using (owner_id = auth.uid());

-- tasks: видят все авторизованные, создаёт любой авторизованный, редактирует создатель/исполнитель
create policy "tasks_select_all"   on tasks for select using (auth.role() = 'authenticated');
create policy "tasks_insert_auth"  on tasks for insert with check (auth.role() = 'authenticated');
create policy "tasks_update_owner" on tasks for update using (created_by = auth.uid() or assignee_id = auth.uid());

-- notifications: только свои
create policy "notif_select_own" on notifications for select using (user_id = auth.uid());
create policy "notif_update_own" on notifications for update using (user_id = auth.uid());
```

## 2. Деплой на Vercel

### 2.1. Подключить репозиторий

```bash
# Если ещё нет git remote
git remote add origin <ваш-github-repo>
git push -u origin master
```

В Vercel Dashboard → **Add New Project** → импортировать репозиторий.

Vercel автоматически определит Vite. `vercel.json` уже содержит нужный rewrite:
```json
{ "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }] }
```

### 2.2. Environment Variables

В Vercel **Project Settings → Environment Variables** добавить (для всех окружений: Production, Preview, Development):

| Имя                          | Значение                 | Используется в            |
|------------------------------|--------------------------|---------------------------|
| `VITE_SUPABASE_URL`          | `https://xxx.supabase.co`| frontend (build time)     |
| `VITE_SUPABASE_ANON_KEY`     | `eyJ...`                 | frontend (build time)     |
| `SUPABASE_SERVICE_ROLE_KEY`  | `eyJ...`                 | `api/admin.js` (server)   |
| `ANTHROPIC_API_KEY`          | `sk-ant-...`             | `api/tasks.js` (голос)    |

> ⚠️ `VITE_*` переменные попадают в bundle и видны в браузере. Используй только публичный `anon` ключ.
> `SUPABASE_SERVICE_ROLE_KEY` без префикса `VITE_` — он остаётся на сервере.

### 2.3. Redeploy

После добавления env vars: **Deployments → Redeploy** (без env vars frontend соберётся, но Supabase не подключится).

## 3. Локальная разработка

```bash
# 1. Скопировать пример env
cp .env.example .env

# 2. Заполнить .env реальными ключами

# 3. Запустить (в двух терминалах)
npm run dev:api    # API на http://localhost:3001
npm run dev        # Frontend на http://localhost:5173
```

Vite проксирует `/api/*` → `http://localhost:3001` (см. `vite.config.js`).

## 4. Создание первого администратора

`/api/admin` создаёт пользователей, но сам требует авторизации service_role. После первого деплоя:

1. Создай первого пользователя вручную: Supabase **Authentication → Users → Add user**
2. Войди в приложение этим пользователем
3. В Supabase **Table Editor → profiles** установи ему `role = 'admin'`
4. После refresh у него появятся возможности менять роли остальных в TeamPage

## 5. Что проверить после деплоя

- [ ] Вход работает
- [ ] Dashboard загружает задачи
- [ ] Создание проекта работает (схема: `owner_id`, не `created_by`)
- [ ] Голосовой ввод (требует HTTPS — Vercel даёт автоматически)
- [ ] Realtime: открой две вкладки, создай задачу/уведомление в одной — должна появиться в другой
- [ ] Создание пользователя через TeamPage (требует `SUPABASE_SERVICE_ROLE_KEY`)

## Частые проблемы

**`Сервер недоступен` при создании пользователя локально** — забыл запустить `npm run dev:api`.

**`SUPABASE_SERVICE_ROLE_KEY не настроен`** — переменная не добавлена в `.env` или в Vercel.

**Realtime не работает** — replication выключен на таблице в Supabase, см. п. 1.1.

**`Invalid login credentials`** — пользователя не существует или неподтверждён email. Создай через Supabase Dashboard с `email_confirm: true`.

**Голосовой ввод не работает** — Speech Recognition API требует HTTPS (на localhost работает в исключение). Поддерживается только в Chrome/Edge.
