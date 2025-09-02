import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  TEMP_IMAGES: R2Bucket;
};

type ExportedHandlerScheduledHandler = (
  event: ScheduledEvent,
  env: Bindings,
  ctx: ExecutionContext
) => Promise<void> | void;

const app = new Hono<{ Bindings: Bindings }>();

// Global CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
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
      tempUpload: "/api/temp-upload",
      health: "/",
    },
  });
});

// Image validation utilities
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg", 
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_HOSTING_HOURS = 5;

function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large: ${file.size} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes (10MB)`,
    };
  }

  return { valid: true };
}

function validateHostingDuration(hours: number): { valid: boolean; error?: string } {
  if (hours <= 0 || hours > MAX_HOSTING_HOURS) {
    return {
      valid: false,
      error: `Invalid hosting duration: ${hours} hours. Must be between 0 and ${MAX_HOSTING_HOURS} hours`,
    };
  }
  return { valid: true };
}

function generateUniqueKey(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

// Temporary image upload endpoint
app.post("/api/temp-upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("image") as File;
    const durationStr = formData.get("duration") as string;

    if (!file) {
      return c.json({ error: "Missing 'image' file in form data" }, 400);
    }

    if (!durationStr) {
      return c.json({ error: "Missing 'duration' parameter (hours)" }, 400);
    }

    const duration = parseFloat(durationStr);
    if (isNaN(duration)) {
      return c.json({ error: "Invalid 'duration' parameter, must be a number" }, 400);
    }

    // Validate hosting duration
    const durationValidation = validateHostingDuration(duration);
    if (!durationValidation.valid) {
      return c.json({ error: durationValidation.error }, 400);
    }

    // Validate image file
    const fileValidation = validateImageFile(file);
    if (!fileValidation.valid) {
      return c.json({ error: fileValidation.error }, 400);
    }

    // Generate unique key and calculate expiration
    const key = generateUniqueKey();
    const expirationTime = new Date(Date.now() + duration * 60 * 60 * 1000);

    // Upload to R2 with metadata
    const uploadResult = await c.env.TEMP_IMAGES.put(key, file, {
      httpMetadata: {
        contentType: file.type,
        contentDisposition: "inline",
        cacheControl: "public, max-age=3600",
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        expiresAt: expirationTime.toISOString(),
        durationHours: duration.toString(),
      },
    });

    if (!uploadResult) {
      console.error("Failed to upload file to R2");
      return c.json({ error: "Failed to upload image" }, 500);
    }

    // Log the upload
    console.log(`Image uploaded: ${key}, expires at: ${expirationTime.toISOString()}`);

    // Return success response
    const tempUrl = `/api/temp-image/${key}`;
    return c.json({
      success: true,
      key,
      url: tempUrl,
      expiresAt: expirationTime.toISOString(),
      durationHours: duration,
      originalName: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error("Error uploading temporary image:", error);
    return c.json(
      {
        error: "Failed to upload image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// Serve temporary images
app.get("/api/temp-image/:key", async (c) => {
  try {
    const key = c.req.param("key");
    
    if (!key) {
      return c.json({ error: "Missing image key" }, 400);
    }

    // Get object from R2
    const object = await c.env.TEMP_IMAGES.get(key);
    
    if (!object) {
      return c.json({ error: "Image not found or expired" }, 404);
    }

    // Check if image has expired
    const expiresAt = object.customMetadata?.expiresAt;
    if (expiresAt && new Date() > new Date(expiresAt)) {
      // Delete expired image
      await c.env.TEMP_IMAGES.delete(key);
      console.log(`Deleted expired image: ${key}`);
      return c.json({ error: "Image has expired" }, 410);
    }

    // Return the image
    const headers = new Headers({
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": object.size.toString(),
      "Cache-Control": "public, max-age=300", // 5 minutes cache
      "Content-Disposition": object.httpMetadata?.contentDisposition || "inline",
    });

    // Add CORS headers
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error serving temporary image:", error);
    return c.json(
      {
        error: "Failed to serve image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
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

// Scheduled cleanup job for expired images
export const scheduled: ExportedHandlerScheduledHandler = async (event, env, ctx) => {
  console.log("Starting cleanup job for expired images");
  
  try {
    const tempImages = env.TEMP_IMAGES as R2Bucket;
    let deleted = 0;
    let errors = 0;

    // List all objects in the bucket
    const list = await tempImages.list();
    
    for (const object of list.objects) {
      try {
        // Get the object to check its metadata
        const objectDetails = await tempImages.head(object.key);
        
        if (!objectDetails) {
          continue;
        }

        // Check if the image has expired
        const expiresAt = objectDetails.customMetadata?.expiresAt;
        if (expiresAt && new Date() > new Date(expiresAt)) {
          await tempImages.delete(object.key);
          deleted++;
          console.log(`Deleted expired image: ${object.key}`);
        }
      } catch (error) {
        errors++;
        console.error(`Error processing image ${object.key}:`, error);
      }
    }

    console.log(`Cleanup job completed. Deleted: ${deleted}, Errors: ${errors}, Total checked: ${list.objects.length}`);
  } catch (error) {
    console.error("Error in cleanup job:", error);
  }
};

export default app;
