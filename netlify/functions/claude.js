exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: event.body,
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: await res.text(),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

