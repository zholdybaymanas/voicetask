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

### 1.2.1. Auto-создание профиля при регистрации

Чтобы новые пользователи (signup и admin createUser) автоматически получали строку в `profiles`, добавь триггер. В Supabase **SQL Editor** → New query:

```sql
-- Функция, создающая profile при insert в auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Триггер
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

После применения: каждая регистрация (signup на `/auth` или из `/api/admin`) создаёт профиль с ролью `member`. Менять роль может админ через TeamPage.

### 1.2.2. Email confirmation (опционально)

По умолчанию Supabase требует подтверждения email перед первым входом. Для команды разработчиков это может быть неудобно. Если хотите, чтобы регистрация сразу логинила:

**Authentication → Providers → Email** → отключить **Confirm email**.

Если оставлено включённым — после signup юзер увидит сообщение «Подтвердите email», и должен кликнуть по ссылке в письме перед первым входом.

### 1.2.4. Колонка `sort_order` для перетягивания в канбане

Перетягивание задач внутри колонки сохраняется в поле `sort_order` (используем именно это имя, а не `order`, потому что `order` зарезервирован в PostgREST как параметр сортировки).

```sql
alter table tasks add column if not exists sort_order double precision;

-- Бэкфил для уже существующих задач: чем новее, тем выше (большее значение)
update tasks
set sort_order = extract(epoch from created_at)
where sort_order is null;

create index if not exists tasks_sort_order_idx on tasks (sort_order desc);
```

После этого канбан грузит задачи `order=sort_order.desc.nullslast,created_at.desc` и сохраняет новое значение через `supabasePatch` при каждом drop.

### 1.2.3. Миграция статусов задач (Kanban)

Канбан использует 4 статуса: `pending`, `in_progress`, `review`, `done`.
Если у вас уже есть строки со старыми значениями (`todo`, `cancelled`) — выполните одной транзакцией:

```sql
-- Сначала ослабляем constraint, чтобы UPDATE прошёл
alter table tasks drop constraint if exists tasks_status_check;

-- Маппим старые значения в новые
update tasks set status = 'pending' where status = 'todo';
update tasks set status = 'done'    where status = 'cancelled';

-- Возвращаем строгий constraint
alter table tasks add constraint tasks_status_check
  check (status in ('pending', 'in_progress', 'review', 'done'));

-- Меняем default для будущих INSERT
alter table tasks alter column status set default 'pending';
```

### 1.2.5. Google Calendar интеграция

**Таблица `user_integrations`** + колонка `tasks.gcal_event_id`. Выполни в SQL Editor:

```sql
create table if not exists user_integrations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references profiles(id) on delete cascade,
  provider      text not null,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, provider)
);

alter table tasks add column if not exists gcal_event_id text;

-- RLS: пользователь видит и удаляет только свои интеграции; INSERT/UPDATE — только через service_role с сервера
alter table user_integrations enable row level security;
drop policy if exists "user_integrations_select_own" on user_integrations;
drop policy if exists "user_integrations_delete_own" on user_integrations;
create policy "user_integrations_select_own" on user_integrations
  for select to authenticated using (user_id = auth.uid());
create policy "user_integrations_delete_own" on user_integrations
  for delete to authenticated using (user_id = auth.uid());
```

**Google Cloud OAuth setup:**

1. [console.cloud.google.com](https://console.cloud.google.com) → создать проект (или взять существующий)
2. **APIs & Services → Library** → найти **Google Calendar API** → **Enable**
3. **APIs & Services → OAuth consent screen** → External → заполнить приложение (название VoiceTask, support email). Scopes — добавить `auth/calendar.events`. В Test users — свой email пока приложение в тестовом режиме (или сразу publish для production)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URIs: `https://voicetask-cfo.vercel.app/api/google-calendar?action=callback` (плюс `http://localhost:5173/api/google-calendar?action=callback` для локальной разработки)
5. Скопировать **Client ID** и **Client Secret**
6. В Vercel Environment Variables добавить:
   - `GOOGLE_CLIENT_ID` (без VITE-префикса — server-only)
   - `GOOGLE_CLIENT_SECRET` (server-only)
7. Redeploy

### 1.2.6. Словарь голосовых ключевых слов

**Таблица `voice_keywords`** + триггеры авто-генерации. Парсер задач (`/api/tasks`) подмешивает эти варианты в промпт Haiku, чтобы лучше распознавать имена и проекты в склонениях / транслите.

```sql
create table if not exists voice_keywords (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('assignee', 'project')),
  canonical_id uuid not null,
  keyword      text not null,
  created_at   timestamptz default now(),
  unique (type, canonical_id, keyword)
);
create index if not exists voice_keywords_type_idx on voice_keywords(type);

alter table voice_keywords enable row level security;

drop policy if exists "voice_keywords_select_all" on voice_keywords;
create policy "voice_keywords_select_all" on voice_keywords
  for select to authenticated using (true);

-- Хелпер: транслитерация казахских букв в русские эквиваленты
-- (ә→а, ғ→г, қ→к, ң→н, ө→о, ұ/ү→у, һ→х, і→и). Используется чтобы
-- "Мәнгілік" автоматически попало в keywords как "мангилик" — это нужно
-- потому что Speech API часто транскрибирует в одну сторону, а в БД
-- название может быть в другой.
create or replace function kz_to_ru(input text)
returns text as $$
  select translate(coalesce(input, ''), 'әғқңөұүһі', 'агкноуухи')
$$ language sql immutable;

-- Авто-генерация: имя, фамилия, имя+фамилия (lower-case) + казахско-нормализованные варианты
create or replace function generate_voice_keywords_for_profile()
returns trigger as $$
declare
  parts text[];
  part  text;
  raw   text;
  norm  text;
begin
  delete from voice_keywords where type = 'assignee' and canonical_id = NEW.id;
  if NEW.full_name is null or length(trim(NEW.full_name)) = 0 then
    return NEW;
  end if;
  raw  := lower(trim(NEW.full_name));
  norm := kz_to_ru(raw);
  insert into voice_keywords (type, canonical_id, keyword) values ('assignee', NEW.id, raw)  on conflict do nothing;
  if norm <> raw then
    insert into voice_keywords (type, canonical_id, keyword) values ('assignee', NEW.id, norm) on conflict do nothing;
  end if;
  parts := regexp_split_to_array(raw, '\s+');
  foreach part in array parts loop
    if length(part) >= 2 then
      insert into voice_keywords (type, canonical_id, keyword) values ('assignee', NEW.id, part) on conflict do nothing;
      if kz_to_ru(part) <> part then
        insert into voice_keywords (type, canonical_id, keyword) values ('assignee', NEW.id, kz_to_ru(part)) on conflict do nothing;
      end if;
    end if;
  end loop;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_voice_keywords on profiles;
create trigger profiles_voice_keywords
  after insert or update of full_name on profiles
  for each row execute function generate_voice_keywords_for_profile();

-- Авто-генерация для проектов (та же логика)
create or replace function generate_voice_keywords_for_project()
returns trigger as $$
declare
  parts text[];
  part  text;
  raw   text;
  norm  text;
begin
  delete from voice_keywords where type = 'project' and canonical_id = NEW.id;
  if NEW.name is null or length(trim(NEW.name)) = 0 then
    return NEW;
  end if;
  raw  := lower(trim(NEW.name));
  norm := kz_to_ru(raw);
  insert into voice_keywords (type, canonical_id, keyword) values ('project', NEW.id, raw)  on conflict do nothing;
  if norm <> raw then
    insert into voice_keywords (type, canonical_id, keyword) values ('project', NEW.id, norm) on conflict do nothing;
  end if;
  parts := regexp_split_to_array(raw, '\s+');
  foreach part in array parts loop
    if length(part) >= 2 then
      insert into voice_keywords (type, canonical_id, keyword) values ('project', NEW.id, part) on conflict do nothing;
      if kz_to_ru(part) <> part then
        insert into voice_keywords (type, canonical_id, keyword) values ('project', NEW.id, kz_to_ru(part)) on conflict do nothing;
      end if;
    end if;
  end loop;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists projects_voice_keywords on projects;
create trigger projects_voice_keywords
  after insert or update of name on projects
  for each row execute function generate_voice_keywords_for_project();

-- Backfill для уже существующих строк (триггеры сработают только на будущие изменения)
update profiles set full_name = full_name where full_name is not null;
update projects set name      = name      where name      is not null;
```

### 1.3. RLS политики (если ещё не настроены)

Минимальные политики для работы приложения:

```sql
-- profiles: каждый видит всех
create policy "profiles_select_all" on profiles for select using (true);

-- projects: видят все авторизованные, создаёт/редактирует владелец
create policy "projects_select_all"  on projects for select using (auth.role() = 'authenticated');
create policy "projects_insert_own"  on projects for insert with check (owner_id = auth.uid());
create policy "projects_update_own"  on projects for update using (owner_id = auth.uid());

-- tasks: каждый видит только свои (где он assignee или creator); admin видит всё
drop policy if exists "tasks_select_all" on tasks;
drop policy if exists "tasks_select_own" on tasks;
drop policy if exists "tasks_select_admin" on tasks;
create policy "tasks_select_own"   on tasks for select to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid());
create policy "tasks_select_admin" on tasks for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "tasks_insert_auth"  on tasks for insert with check (auth.role() = 'authenticated');
create policy "tasks_update_owner" on tasks for update using (created_by = auth.uid() or assignee_id = auth.uid());
create policy "tasks_delete_owner" on tasks for delete using (created_by = auth.uid());

-- notifications: читать/обновлять только свои; INSERT — любой авторизованный
-- (нужно чтобы при создании задачи можно было создать уведомление другому пользователю)
create policy "notif_select_own"   on notifications for select using (user_id = auth.uid());
create policy "notif_update_own"   on notifications for update using (user_id = auth.uid());
create policy "notif_insert_authed" on notifications for insert with check (auth.role() = 'authenticated');
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
| `VITE_APP_URL`               | `https://voicetask-cfo.vercel.app` | `emailRedirectTo` для signup/reset |
| `SUPABASE_SERVICE_ROLE_KEY`  | `eyJ...`                 | `api/admin.js` (server)   |
| `ANTHROPIC_API_KEY`          | `sk-ant-...`             | `api/tasks.js` (голос)    |
| `GOOGLE_CLIENT_ID` *(опц.)*  | `xxx.apps.googleusercontent.com` | `api/google-calendar.js` |
| `GOOGLE_CLIENT_SECRET` *(опц.)* | `GOCSPX-...`         | `api/google-calendar.js` |

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
