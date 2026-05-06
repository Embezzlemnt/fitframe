import { handleSubmitOrder } from "../functions/api/submit-order.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/submit-order") {
      if (request.method === "POST") return handleSubmitOrder({ request, env });
      if (request.method === "OPTIONS") return new Response(null, {
        status:204,
        headers:{
          "Content-Type":"application/json",
          "X-Content-Type-Options":"nosniff",
        },
      });
      return new Response(JSON.stringify({ error:"Method not allowed." }), {
        status:405,
        headers:{
          "Content-Type":"application/json",
          "X-Content-Type-Options":"nosniff",
        },
      });
    }

    return new Response(null, { status:404 });
  },
};
