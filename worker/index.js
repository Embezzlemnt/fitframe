export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error:"Not found." }), {
        status:404,
        headers:{
          "Content-Type":"application/json",
          "X-Content-Type-Options":"nosniff",
        },
      });
    }

    return new Response(null, { status:404 });
  },
};
