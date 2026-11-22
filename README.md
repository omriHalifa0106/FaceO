# FaceO

Photo sharing for events and groups, with automatic face recognition: upload the
event's photos, and everyone finds the ones they're in.

| Layer | Tech |
|---|---|
| Web app | React 19 + TypeScript + Vite + Tailwind (`client/`) |
| Auth / DB | Supabase Auth + Postgres with `pgvector` (`supabase/migrations/`) |
| File storage | Cloudflare R2, direct browser uploads through presigned URLs |
| Presign API | Supabase Edge Function `r2-presign` (`supabase/functions/r2-presign/`) |
| Face recognition | `@vladmandic/face-api` **in the browser** (128-d descriptors) |

## How it works

```
Browser ──(1) JWT──▶ r2-presign ──checks membership──▶ presigned PUT URL
Browser ──(2) PUT bytes───────────────────────────────▶ Cloudflare R2
Browser ──(3) insert photos row (key + metadata)──────▶ Supabase
Browser ──(4) detect faces locally → 128-d vectors
Browser ──(5) rpc ingest_photo_faces(photo, faces)────▶ Postgres matches each face:
               member with enrolled face → existing guest → new "Guest N"
```

* **Biometric isolation.** Face vectors live only in `user_face_embeddings`
  (owner-only RLS) and `tag_embeddings` (no client access at all). Matching runs
  inside `SECURITY DEFINER` SQL functions, so a browser never receives another
  person's vector. The app's `AuthContext` / `entities.ts` never select them;
  only `src/lib/faceRecognition.ts` and `src/lib/guestResolution.ts` touch
  biometric data.
* **Guests.** Faces that don't match a member become event guests ("Guest 3").
  When that person joins the group (invite link) or sets up their face, their
  guest faces are moved to them automatically (`resolve_my_guest_tags`).
  Members can also rename guests, merge guests, or reassign any face manually.
* **Selfies for enrollment are never uploaded**: only the averaged descriptor is stored.

### Project layout

```
client/
  scripts/copy-face-models.mjs  copies model weights into public/models (postinstall)
  src/
    api/entities.ts             data layer: User, Group, Photo, EventGuest, Tag
    context/AuthContext.tsx     session / user / profile / isLoadingAuth / authError
    lib/supabaseClient.ts       Supabase client + R2 public URL helper
    lib/storage.ts              presign → PUT to R2 (progress) → DB row
    lib/faceRecognition.ts      model loading, detection, enrollment
    lib/guestResolution.ts      ingest faces, batch re-scan, guest promotion
    lib/result.ts               Result<T> = { data, error } used by every call
    components/ hooks/ pages/   UI
supabase/
  migrations/20261121000000_faceo_init.sql   full schema, RLS, RPCs
  functions/r2-presign/index.ts              presign + delete edge function
```

## Setup checklist

Prerequisites: Node 20+, a Supabase project, a Cloudflare account with R2,
and the [Supabase CLI](https://supabase.com/docs/guides/cli).

### 1. Database

1. Supabase Dashboard → **SQL Editor** → run every file in `supabase/migrations/`
   **in filename order**:
   * `20261121000000_faceo_init.sql` — extensions (`vector`, `pgcrypto`), tables, RLS, indexes, triggers, RPCs
   * `20261122000000_photo_thumbnails.sql` — grid thumbnails
   * `20261122010000_consent_and_hide_me.sql` — biometric consent (DB-enforced) and "Hide me"
   *Or with the CLI:* `supabase link --project-ref <ref>` then `supabase db push`.
2. **Authentication → URL Configuration**
   * Site URL: your production URL (e.g. `https://faceo.example.com`)
   * Redirect URLs: `http://localhost:5173/**` and `https://faceo.example.com/**`
     (needed for email confirmation and `/reset-password`).

### 2. Cloudflare R2

1. **R2 → Create bucket** (e.g. `faceo-photos`).
2. Bucket **Settings → Public access**: enable the `r2.dev` subdomain or connect a
   custom domain. That base URL is `R2_PUBLIC_URL` (no trailing slash).
3. **R2 → Manage API tokens → Create API token**, permission *Object Read & Write*,
   scoped to this bucket. Note the **Access Key ID** and **Secret Access Key**.
   Your **Account ID** is shown on the R2 overview page.
4. Bucket **Settings → CORS policy** — allow browser uploads (PUT) and reading pixels
   for face re-scans (GET):

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "https://faceo.example.com"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

### 3. Edge Function secrets & deploy

```bash
supabase link --project-ref <your-project-ref>

supabase secrets set \
  R2_ACCOUNT_ID=<account-id> \
  R2_ACCESS_KEY_ID=<access-key-id> \
  R2_SECRET_ACCESS_KEY=<secret-access-key> \
  R2_BUCKET=faceo-photos \
  R2_PUBLIC_URL=https://<your-public-bucket-domain> \
  ALLOWED_ORIGINS=http://localhost:5173,https://faceo.example.com

supabase functions deploy r2-presign
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically. JWT
verification stays on (the default), so only signed-in users can call it.

### 4. Web app

```bash
cd client
npm install                 # also copies face models into public/models
cp .env.example .env        # fill in the three values below
npm run dev                 # http://localhost:5173
```

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_R2_PUBLIC_URL=https://<your-public-bucket-domain>   # same as R2_PUBLIC_URL
```

Production build: `npm run build` → static files in `client/dist/` (serve with SPA
fallback to `index.html`).

### 5. Smoke test

1. Register → you land on **Profile & face** → add 1–3 selfies → *Save face profile*.
2. Create an event → **Upload** a few photos of yourself and others.
3. Filter **I'm in** shows your photos; **People** shows a folder per person.
4. Open the invite link in another browser, register a second user, enroll a face,
   join → their earlier guest faces now show under their name.

## Notes & limitations

* **Public bucket.** Anyone holding a photo URL can open it. Object keys are random
  UUIDs (unguessable), but URLs are bearer links. Use signed GET URLs if that's not
  acceptable.
* **Biometric data** (face descriptors) is regulated in many jurisdictions (GDPR
  art. 9, Israeli Privacy Protection Regulations, BIPA). Get explicit consent at
  enrollment and document retention. Users can delete their own face data from
  their profile; descriptors of faces in photos are removed with the photo/group.
* **Client-computed vectors are trusted.** A malicious member could submit forged
  descriptors, but only inside groups they already belong to, so it can't expose
  photos they couldn't already see.
* **Matching threshold** is L2 distance `0.5` (`public.face_match_threshold()` and
  `FACE_MATCH_THRESHOLD` in `faceRecognition.ts`; keep them equal).
* If an upload reaches R2 but the DB insert fails, the object is orphaned. A
  periodic cleanup of keys without a `photos` row is recommended.
