// Route all POST saves through our password-checked backend.
import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Owner-Pass",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });

export default async (req, context) => {
  const store = getStore("the-circle-posts");
  let OWNER_PASS = null;
  try {
    OWNER_PASS = context?.env?.OWNER_PASS
      ?? (typeof Netlify !== "undefined" && Netlify.env?.get ? Netlify.env.get("OWNER_PASS") : null);
  } catch {
    OWNER_PASS = null;
  }

  // CORS preflight
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    const pass = req.headers.get("x-owner-pass") ?? "";
    const auth = !!OWNER_PASS && pass.length > 0 && pass === OWNER_PASS;
    const raw = await store.get("posts");
    const posts = raw ? JSON.parse(raw) : null;
    return json({ posts, auth });
  }

  if (req.method === "POST") {
    if (!OWNER_PASS) return json({ error: "Server missing OWNER_PASS env var — run netlify env:set." }, 500);
    const pass = req.headers.get("x-owner-pass") ?? "";
    if (pass !== OWNER_PASS) return json({ error: "Wrong owner password." }, 401);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    if (!body || !Array.isArray(body.posts))
      return json({ error: "Body must be { posts: [...] }." }, 400);
    if (body.posts.length > 300)
      return json({ error: "Too many posts in one save (limit 300)." }, 413);

    for (const p of body.posts) {
      if (typeof p?.title !== "string" || !p.title.trim())
        return json({ error: "Every post needs a title." }, 400);
      if (typeof p?.date !== "string" || !p.date.trim())
        return json({ error: "Every post needs a date." }, 400);
      if (!Array.isArray(p.photos) || !Array.isArray(p.people) || !Array.isArray(p.places) || !Array.isArray(p.schools))
        return json({ error: "A post is missing its photos/people/places/schools arrays." }, 400);
      for (const photo of p.photos) {
        if (typeof photo.src !== "string" || photo.src.length > 3_000_000)
          return json({ error: `Photo in “${p.title}” is missing or too large.` }, 413);
      }
    }

    await store.set("posts", JSON.stringify(body.posts));
    return json({ ok: true, count: body.posts.length });
  }

  return json({ error: "Method not allowed." }, 405);
};
