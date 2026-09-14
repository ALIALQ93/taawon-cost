# مطابقة تكلفة المخزون (Taawon Cost)

أداة ويب لمطابقة تكلفة بضاعة أول المدة بين البيان القديم وSky، مع مستخدمين وأدوار على **Supabase** واستضافة على **Vercel** (الخطة المجانية).

## الأدوار

| الدور | التكلفة | مراجعة | تصدير Excel | إدارة الأدوار |
|--------|---------|--------|-------------|---------------|
| `viewer` مشاهد | لا | لا | لا | لا |
| `reviewer` مراجع | لا | نعم (بدون تكلفة يدوية) | لا | لا |
| `admin` مسؤول | نعم | نعم | نعم | من لوحة Supabase |

## الإعداد السريع

### 1) مشروع Supabase
1. أنشئ مشروعاً مجانياً على [supabase.com](https://supabase.com)
2. افتح **SQL Editor** ونفّذ ملف [`supabase/schema.sql`](supabase/schema.sql)
3. من **Authentication → Providers**: فعّل Email
4. من **Authentication → Providers → Email**: عطّل **Enable sign ups** إن أردت منع التسجيل العام (موصى به)
5. أنشئ أول مستخدم من **Authentication → Users → Add user**
6. اجعله مسؤولاً:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

7. أنشئ باقي المستخدمين من اللوحة، ثم عيّن أدوارهم:

```sql
update public.profiles set role = 'reviewer' where id = (
  select id from auth.users where email = 'reviewer@example.com'
);
```

### 2) إعداد الواجهة
```bash
cp docs/config.example.js docs/config.js
```
املأ من **Settings → API**:
- `supabaseUrl`
- `supabaseAnonKey` (المفتاح العام anon)

ضع ملفات البيانات في:
```
docs/data/albayan.json
docs/data/sky_items.json
docs/data/matches.json
docs/data/sky_lines.json
```

### 3) التشغيل محلياً
من مجلد `docs` أي خادم ثابت، مثال:
```bash
npx --yes serve docs
```

### 4) النشر على Vercel (مجاني)
1. ارفع المستودع إلى GitHub
2. Import في Vercel
3. في شاشة الإعداد غيّر التالي:
   - **Root Directory** → `docs` (اضغط Edit بجانب `./`)
   - **Build Command** → `npm run build`
   - **Output Directory** → اتركه فارغاً أو `.`
   - **Install Command** → `npm install` (أو الافتراضي)
4. Environment Variables (Production + Preview):
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - لا تضف `SUPABASE_SECRET_KEY` هنا
5. Deploy

أمر البناء يولّد `config.js` من متغيرات البيئة تلقائياً.

## ملاحظات أمان (مهمة)
- مفتاح **anon** مصمَّم ليكون عاماً؛ الحماية الحقيقية عبر **RLS** في Supabase.
- التكلفة مخفية في الواجهة لغير المسؤول، و`cost_override` يُصفَّر في view `reviews_visible`.
- ملفات `docs/data/*.json` إن وُضعت عامة على Vercel يمكن جلبها مباشرة — للإنتاج الأفضل لاحقاً نقلها إلى Storage خاص أو API. حالياً التطبيق يصفّر حقول التكلفة في الذاكرة لغير المسؤول.

## هيكل الملفات
```
docs/           ← واجهة Vercel
supabase/       ← schema.sql
vercel.json
```
