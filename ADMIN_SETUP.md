# OrSight Admin Dashboard Setup

## 1. Database Setup

To enable usage tracking and the admin dashboard, you need to run the following SQL script in your Supabase project's SQL Editor.

1. Go to your Supabase project dashboard.
2. Click on "SQL Editor" in the left sidebar.
3. Click "New query".
4. Copy the contents of `webapp/supabase/admin_schema.sql` and paste it into the editor.
5. Click "Run".

## 2. Add an Admin User

After creating the tables, you need to manually add yourself as an admin so you can log into the dashboard.

1. Go to the "Table Editor" in Supabase.
2. Open the `auth.users` table (you might need to select the `auth` schema from the schema dropdown at the top).
3. Find your user record and copy your `id` (UUID) and `email`.
4. Switch back to the `public` schema and open the `admin_users` table.
5. Click "Insert row" and paste your `id` and `email`.

Now your account has admin privileges.

## 3. Configure Admin Webapp

The admin dashboard is a separate Next.js application located in the `admin-webapp` folder.

1. Copy `.env.example` to `.env.local` inside the `admin-webapp` folder.
2. Fill in the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the same values used in your main `webapp`.
3. Fill in `SUPABASE_SERVICE_ROLE_KEY` (required for fetching all users' data).

## 4. Run the Admin Dashboard

```bash
cd admin-webapp
npm install
npm run dev
```

The admin dashboard will run on `http://localhost:3001` (if the main app is on 3000).
