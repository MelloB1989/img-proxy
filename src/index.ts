import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  // Add environment variables here if needed
};

const app = new Hono<{ Bindings: Bindings }>();

// Global CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "Image Proxy Worker",
    version: "1.0.0",
    endpoints: {
      proxy: "/img?url=<encoded-image-url>",
      health: "/",
    },
  });
});

// Image proxy endpoint
app.get("/img", async (c) => {
  const targetParam = c.req.query("url");

  if (!targetParam) {
    return c.json({ error: "Missing 'url' query parameter" }, 400);
  }

  let target: URL;
  try {
    target = new URL(decodeURIComponent(targetParam));
  } catch {
    return c.json({ error: "Invalid URL provided" }, 400);
  }

  // Security checks
  if (!["http:", "https:"].includes(target.protocol)) {
    return c.json({ error: "Only HTTP(S) URLs are allowed" }, 400);
  }

  try {
    // Fetch the image
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HonoImageProxy/1.0)",
        Accept: "image/*,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
      // Cloudflare-specific caching options
      cf: {
        cacheEverything: true,
        cacheTtl: 3600, // 1 hour
      },
    });

    if (!response.ok) {
      return c.json(
        {
          error: `Failed to fetch image: ${response.status} ${response.statusText}`,
          host: target.hostname,
        },
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }

    const contentType = response.headers.get("Content-Type") || "";

    // Validate it's an image
    if (!contentType.toLowerCase().startsWith("image/")) {
      return c.json(
        {
          error: `URL does not point to an image. Content-Type: ${contentType}`,
        },
        400,
      );
    }

    // Set response headers
    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=600, s-maxage=3600",
      "Content-Disposition": "inline",
    });

    // Copy useful headers from the original response
    const headersToCopy = ["ETag", "Last-Modified", "Content-Length"];
    headersToCopy.forEach((header) => {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders.set(header, value);
      }
    });

    return new Response(response.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return c.json(
      {
        error: "Failed to fetch image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// Handle all other HTTP methods for /img endpoint
app.all("/img", async (c) => {
  const method = c.req.method;

  if (method === "HEAD") {
    // Handle HEAD requests
    const targetParam = c.req.query("url");

    if (!targetParam) {
      return c.json({ error: "Missing 'url' query parameter" }, 400);
    }

    let target: URL;
    try {
      target = new URL(decodeURIComponent(targetParam));
    } catch {
      return c.json({ error: "Invalid URL provided" }, 400);
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return c.json({ error: "Only HTTP(S) URLs are allowed" }, 400);
    }

    try {
      const response = await fetch(target.toString(), {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HonoImageProxy/1.0)",
          Accept: "image/*,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return c.json(
          {
            error: `Failed to fetch image: ${response.status} ${response.statusText}`,
          },
          response.status >= 400 && response.status < 500
            ? response.status
            : 502,
        );
      }

      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        return c.json(
          {
            error: `URL does not point to an image. Content-Type: ${contentType}`,
          },
          400,
        );
      }

      const responseHeaders = new Headers({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=600, s-maxage=3600",
      });

      const headersToCopy = ["ETag", "Last-Modified", "Content-Length"];
      headersToCopy.forEach((header) => {
        const value = response.headers.get(header);
        if (value) {
          responseHeaders.set(header, value);
        }
      });

      return new Response(null, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to fetch image headers",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  }

  // Method not allowed for other HTTP methods
  return c.json(
    {
      error: "Method Not Allowed",
      allowed: ["GET", "HEAD", "OPTIONS"],
      received: method,
    },
    405,
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: "Use /img?url=<encoded-image-url> to proxy images",
      availableEndpoints: ["/", "/img"],
    },
    404,
  );
});

// Global error handler
app.onError((err, c) => {
  console.error("Application error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: "Something went wrong processing your request",
    },
    500,
  );
});

export default app;
