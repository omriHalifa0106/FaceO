// supabase/functions/r2-presign/index.ts
//
// Issues short-lived presigned PUT URLs for direct browser -> Cloudflare R2
// uploads, and deletes R2 objects for photos the caller is allowed to delete.
//
// POST (Authorization: Bearer <user JWT>)
//   { "action": "upload", "purpose": "photo", "groupId": "<uuid>",
//     "files": [{ "contentType": "image/jpeg", "size": 123456 }, ...] }
//   { "action": "upload", "purpose": "avatar",
//     "files": [{ "contentType": "image/jpeg", "size": 12345 }] }
//   -> { "uploads": [{ key, uploadUrl, publicUrl, headers }], "expiresIn": 600 }
//
//   { "action": "delete", "photoId": "<uuid>" }
//   -> { "deleted": true }
//
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//          R2_PUBLIC_URL, optional ALLOWED_ORIGINS (comma separated).
// SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const MAX_FILES_PER_REQUEST = 50;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const URL_TTL_SECONDS = 600;
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

const R2_ACCOUNT_ID = requireEnv("R2_ACCOUNT_ID");
const R2_BUCKET = requireEnv("R2_BUCKET");
const R2_PUBLIC_URL = requireEnv("R2_PUBLIC_URL").replace(/\/+$/, "");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;

const r2 = new AwsClient({
  accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
  secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  let allowOrigin = "*";
  if (ALLOWED_ORIGINS.length > 0) {
    allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// R2 operations
// ---------------------------------------------------------------------------
function objectUrl(key: string): string {
  return `${R2_ENDPOINT}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function presignPut(key: string, contentType: string): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(URL_TTL_SECONDS));
  // Content-Type is part of the signature: the browser must send exactly it.
  const signed = await r2.sign(
    new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url;
}

async function deleteObject(key: string): Promise<void> {
  const res = await r2.fetch(objectUrl(key), { method: "DELETE" });
  // R2 returns 204 for both existing and already-missing objects.
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed (${res.status}): ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
type FileSpec = { contentType: string; size: number };

function validateFiles(raw: unknown, maxBytes: number, maxCount: number): FileSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "files must be a non-empty array");
  if (raw.length > maxCount) throw new HttpError(400, `At most ${maxCount} files per request`);
  return raw.map((f, i) => {
    const contentType = String(f?.contentType ?? "").toLowerCase();
    const size = Number(f?.size);
    if (!EXTENSION_BY_TYPE[contentType]) {
      throw new HttpError(415, `File ${i + 1}: only JPEG, PNG and WebP images are allowed`);
    }
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
      throw new HttpError(413, `File ${i + 1}: size must be between 1 byte and ${Math.round(maxBytes / 1048576)} MB`);
    }
    return { contentType, size };
  });
}

async function handleUpload(supabase: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const purpose = body.purpose ?? "photo";
  let prefix: string;
  let files: FileSpec[];

  if (purpose === "photo") {
    const groupId = String(body.groupId ?? "");
    if (!UUID_RE.test(groupId)) throw new HttpError(400, "groupId is required");
    // RLS on group_members only returns rows for groups the caller belongs to.
    const { data, error } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Membership check failed: ${error.message}`);
    if (!data) throw new HttpError(403, "You are not a member of this group");
    prefix = `groups/${groupId}`;
    files = validateFiles(body.files, MAX_PHOTO_BYTES, MAX_FILES_PER_REQUEST);
  } else if (purpose === "avatar") {
    prefix = `avatars/${userId}`;
    files = validateFiles(body.files, MAX_AVATAR_BYTES, 1);
  } else {
    throw new HttpError(400, "purpose must be 'photo' or 'avatar'");
  }

  const uploads = await Promise.all(
    files.map(async ({ contentType }) => {
      const key = `${prefix}/${crypto.randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;
      return {
        key,
        uploadUrl: await presignPut(key, contentType),
        publicUrl: `${R2_PUBLIC_URL}/${key}`,
        headers: { "Content-Type": contentType },
      };
    }),
  );
  return { uploads, expiresIn: URL_TTL_SECONDS };
}

async function handleDelete(supabase: SupabaseClient, body: Record<string, unknown>) {
  const photoId = String(body.photoId ?? "");
  if (!UUID_RE.test(photoId)) throw new HttpError(400, "photoId is required");

  // Delete the row with the caller's JWT so RLS decides (uploader or admin).
  const { data, error } = await supabase
    .from("photos")
    .delete()
    .eq("id", photoId)
    .select("storage_key");
  if (error) throw new Error(`Photo delete failed: ${error.message}`);
  if (!data || data.length === 0) throw new HttpError(403, "Photo not found or you are not allowed to delete it");

  try {
    await deleteObject(data[0].storage_key);
  } catch (err) {
    // Row is gone (nothing references the file any more); log the orphan.
    console.error(`[r2-presign] orphaned object ${data[0].storage_key}:`, err);
  }
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) throw new HttpError(401, "Invalid or expired session");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }

    switch (body.action ?? "upload") {
      case "upload":
        return json(req, 200, await handleUpload(supabase, user.id, body));
      case "delete":
        return json(req, 200, await handleDelete(supabase, body));
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (err) {
    if (err instanceof HttpError) return json(req, err.status, { error: err.message });
    console.error("[r2-presign]", err);
    return json(req, 500, { error: "Internal error" });
  }
});
