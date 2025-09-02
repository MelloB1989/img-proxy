# Hono Image Proxy

A secure, high-performance image proxy service built with Hono and deployed on Cloudflare Workers. This service allows you to proxy images through your own domain while maintaining security through host allowlisting and proper CORS handling.

## 🚀 Features

- **Secure Host Allowlisting**: Only proxy images from pre-approved domains
- **Temporary Image Upload**: Upload images with configurable expiration times (up to 5 hours)
- **Automatic Cleanup**: Scheduled cleanup of expired temporary images
- **CORS Support**: Proper cross-origin resource sharing headers
- **Edge Caching**: Leverages Cloudflare's global CDN for fast image delivery
- **Content Validation**: Ensures only image content is proxied
- **HTTP/HTTPS Support**: Works with both secure and non-secure origins
- **Error Handling**: Comprehensive error responses with helpful messages
- **Health Monitoring**: Built-in health check endpoint

## 📦 Installation

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI installed globally

```bash
npm install -g wrangler
```

### Setup

1. **Clone and Install**
   ```bash
   git clone <your-repo>
   cd hono-image-proxy
   npm install
   ```

2. **Configure Wrangler**
   ```bash
   wrangler login
   ```

3. **Setup R2 Bucket (for temporary uploads)**

   Create an R2 bucket for temporary image storage:
   ```bash
   wrangler r2 bucket create temp-images
   ```

4. **Update Configuration**

   The `wrangler.jsonc` is already configured with the R2 bucket binding:
   ```json
   {
     "name": "image-proxy",
     "main": "src/index.ts",
     "compatibility_date": "2025-08-16",
     "r2_buckets": [
       {
         "binding": "TEMP_IMAGES",
         "bucket_name": "temp-images"
       }
     ],
     "triggers": {
       "crons": ["0 */1 * * *"]
     }
   }
   ```

## 🚦 Development

### Local Development
```bash
npm run dev
```
Your proxy will be available at `http://localhost:8787`

### Deployment
```bash
npm run deploy
```

## 📖 API Documentation

### Base URL
```
https://your-worker.your-subdomain.workers.dev
```

### Endpoints

#### `GET /`
Health check and service information.

**Response:**
```json
{
  "status": "ok",
  "service": "Image Proxy Worker",
  "version": "1.0.0",
  "endpoints": {
    "proxy": "/img?url=<encoded-image-url>",
    "tempUpload": "/api/temp-upload",
    "health": "/"
  }
}
```

#### `GET /img?url=<encoded-url>`
Proxy an image from an allowed host.

**Parameters:**
- `url` (required): URL-encoded image URL to proxy

**Example:**
```bash
curl "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/example.jpg"
```

**Response Headers:**
- `Content-Type`: Original image content type
- `Cache-Control`: `public, max-age=600, s-maxage=3600`
- `Content-Disposition`: `inline`
- `ETag`: If provided by origin (optional)
- `Last-Modified`: If provided by origin (optional)

**Error Responses:**

- **400 Bad Request**: Missing or invalid URL
  ```json
  {
    "error": "Missing 'url' query parameter"
  }
  ```

- **400 Bad Request**: Not an image
  ```json
  {
    "error": "URL does not point to an image. Content-Type: text/html"
  }
  ```

#### `HEAD /img?url=<encoded-url>`
Get image headers without downloading the content.

Same parameters and responses as GET, but returns only headers.

#### `POST /api/temp-upload`
Upload an image temporarily with configurable expiration time.

**Parameters:**
- `image` (required): Image file to upload (multipart/form-data)
- `duration` (required): Duration in hours (0 < duration ≤ 5)

**Supported File Types:**
- image/jpeg, image/jpg
- image/png  
- image/gif
- image/webp
- image/bmp
- image/svg+xml

**File Size Limit:** 10MB

**Example:**
```bash
curl -X POST \
  -F "image=@my-image.jpg" \
  -F "duration=2.5" \
  https://your-worker.workers.dev/api/temp-upload
```

**Success Response:**
```json
{
  "success": true,
  "key": "temp-1625097600000-abc123def456",
  "url": "/api/temp-image/temp-1625097600000-abc123def456",
  "expiresAt": "2025-09-02T21:30:00.000Z",
  "durationHours": 2.5,
  "originalName": "my-image.jpg",
  "size": 1048576,
  "type": "image/jpeg"
}
```

**Error Responses:**

- **400 Bad Request**: Missing or invalid parameters
  ```json
  {
    "error": "Missing 'image' file in form data"
  }
  ```

- **400 Bad Request**: Invalid duration
  ```json
  {
    "error": "Invalid hosting duration: 6 hours. Must be between 0 and 5 hours"
  }
  ```

- **400 Bad Request**: Invalid file type
  ```json
  {
    "error": "Invalid file type: text/plain. Allowed types: image/jpeg, image/jpg, image/png, image/gif, image/webp, image/bmp, image/svg+xml"
  }
  ```

- **400 Bad Request**: File too large
  ```json
  {
    "error": "File too large: 15728640 bytes. Maximum allowed: 10485760 bytes (10MB)"
  }
  ```

#### `GET /api/temp-image/:key`
Retrieve a temporarily uploaded image.

**Parameters:**
- `key` (required): Unique key returned from upload

**Example:**
```bash
curl "https://your-worker.workers.dev/api/temp-image/temp-1625097600000-abc123def456"
```

**Response Headers:**
- `Content-Type`: Image content type
- `Content-Length`: File size
- `Cache-Control`: `public, max-age=300`
- `Content-Disposition`: `inline`
- `Access-Control-Allow-Origin`: `*`

**Error Responses:**

- **404 Not Found**: Image not found
  ```json
  {
    "error": "Image not found or expired"
  }
  ```

- **410 Gone**: Image has expired
  ```json
  {
    "error": "Image has expired"
  }
  ```

## 🛠️ Usage Examples

### Image Proxying

```javascript
// Basic usage
const proxyUrl = 'https://your-worker.workers.dev/img';
const imageUrl = 'https://media.licdn.com/dms/image/example.jpg';
const proxiedUrl = `${proxyUrl}?url=${encodeURIComponent(imageUrl)}`;

// Fetch image
fetch(proxiedUrl)
  .then(response => response.blob())
  .then(blob => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    document.body.appendChild(img);
  });
```

```javascript
// Using with React
const ImageProxy = ({ src, alt, ...props }) => {
  const proxyUrl = 'https://your-worker.workers.dev/img';
  const proxiedSrc = `${proxyUrl}?url=${encodeURIComponent(src)}`;

  return <img src={proxiedSrc} alt={alt} {...props} />;
};
```

### Temporary Image Upload

```javascript
// Upload a temporary image
async function uploadTempImage(file, durationHours) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('duration', durationHours.toString());

  const response = await fetch('https://your-worker.workers.dev/api/temp-upload', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('Upload successful:', result);
    console.log('Image URL:', `https://your-worker.workers.dev${result.url}`);
    console.log('Expires at:', result.expiresAt);
    return result;
  } else {
    console.error('Upload failed:', result.error);
    throw new Error(result.error);
  }
}

// Example usage
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    try {
      const result = await uploadTempImage(file, 2); // 2 hours
      // Use result.url to display the image
    } catch (error) {
      console.error('Error:', error.message);
    }
  }
});
```

### React Hook for Temporary Upload

```javascript
import { useState } from 'react';

function useTempImageUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const uploadImage = async (file, duration) => {
    setUploading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('duration', duration.toString());

      const response = await fetch('/api/temp-upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error);
      }
      
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { uploadImage, uploading, error };
}

// Usage in component
function ImageUploader() {
  const { uploadImage, uploading, error } = useTempImageUpload();
  const [result, setResult] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const uploadResult = await uploadImage(file, 1); // 1 hour
        setResult(uploadResult);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
  };

  return (
    <div>
      <input type="file" accept="image/*" onChange={handleUpload} />
      {uploading && <p>Uploading...</p>}
      {error && <p>Error: {error}</p>}
      {result && (
        <div>
          <p>Upload successful!</p>
          <img src={result.url} alt="Uploaded" />
          <p>Expires: {new Date(result.expiresAt).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
```

### HTML

```html
<!-- Direct image tag -->
<img src="https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/example.jpg"
     alt="Proxied Image" />

<!-- Background image -->
<div style="background-image: url('https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/example.jpg')">
</div>
```

### cURL Examples

```bash
# Basic image proxy
curl "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/example.jpg" \
  -o proxied-image.jpg

# Get image headers only
curl -I "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/example.jpg"

# Upload temporary image
curl -X POST \
  -F "image=@my-photo.jpg" \
  -F "duration=3" \
  https://your-worker.workers.dev/api/temp-upload

# Download temporary image
curl "https://your-worker.workers.dev/api/temp-image/temp-1625097600000-abc123def456" \
  -o downloaded-image.jpg

# Health check
curl https://your-worker.workers.dev/
```

## 🔧 Configuration

### Environment Variables

Add to `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
LOG_LEVEL = "info"
```

### Cache Settings

Modify cache headers in the response:

```typescript
const responseHeaders = new Headers({
  "Content-Type": contentType,
  "Cache-Control": "public, max-age=3600, s-maxage=7200", // Customize cache time
  "Content-Disposition": "inline",
});
```

## 🔒 Security Features

### Host Allowlisting
Only domains explicitly added to the `ALLOWLIST` can be proxied, preventing abuse.

### Protocol Restriction
Only HTTP and HTTPS protocols are allowed.

### Content Type Validation
Only responses with `Content-Type` starting with `image/` are proxied.

### SSRF Protection
Built-in protection against Server-Side Request Forgery attacks through allowlisting.

### Error Information Limiting
Error responses don't expose full URLs, only hostnames for security.

## 🚨 Error Handling

The service provides detailed error responses for debugging:

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing 'url' parameter | No URL provided in query string |
| 400 | Invalid URL | Malformed URL provided |
| 400 | Only HTTP(S) URLs allowed | Non-HTTP/HTTPS protocol used |
| 400 | Not an image | Content-Type is not image/* |
| 403 | Host not allowed | Domain not in allowlist |
| 404 | Not Found | Invalid endpoint |
| 405 | Method Not Allowed | Unsupported HTTP method |
| 500 | Internal Server Error | Server-side error |
| 502 | Upstream Error | Error from origin server |

## 🎛️ Monitoring

### Health Check
Monitor service health with:
```bash
curl https://your-worker.workers.dev/
```

### Cloudflare Analytics
View metrics in your Cloudflare Workers dashboard:
- Request count
- Error rates
- Response times
- Cache hit ratios

### Logging
Enable detailed logging by adding to your worker:

```typescript
console.log('Proxying:', target.hostname);
console.error('Error details:', error);
```

## 🔄 Caching Strategy

### Edge Caching
- Images are cached at Cloudflare's edge for 1 hour
- Browser caching for 10 minutes
- Conditional requests supported via ETag/Last-Modified

### Cache Headers
```
Cache-Control: public, max-age=600, s-maxage=3600
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Manual Testing
```bash
# Test health endpoint
curl https://your-worker.workers.dev/

# Test valid image proxy
curl "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/test.jpg"

# Test HEAD request for image proxy
curl -I "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/test.jpg"

# Test temporary image upload
curl -X POST \
  -F "image=@test-image.png" \
  -F "duration=1" \
  https://your-worker.workers.dev/api/temp-upload

# Test serving temporary image (use key from upload response)
curl "https://your-worker.workers.dev/api/temp-image/temp-1234567890-abcdef"

# Test error cases
curl -X POST \
  -F "image=@test-image.png" \
  -F "duration=6" \
  https://your-worker.workers.dev/api/temp-upload  # Should fail (>5 hours)

curl -X POST \
  -F "duration=1" \
  https://your-worker.workers.dev/api/temp-upload  # Should fail (missing image)
```

## 📝 Changelog

### v2.0.0
- **NEW**: Temporary image upload API with configurable expiration times
- **NEW**: Automatic cleanup of expired images via scheduled cron job
- **NEW**: Support for multiple image formats (JPEG, PNG, GIF, WebP, BMP, SVG)
- **NEW**: File size validation (10MB limit)
- **NEW**: Comprehensive error handling for uploads
- **NEW**: R2 storage integration for temporary images
- Enhanced CORS support for POST requests
- Added logging for uploads and deletions

### v1.0.0
- Initial release
- Basic image proxying
- Host allowlisting
- CORS support
- Edge caching

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the error responses - they're detailed
2. Verify your domain is in the allowlist
3. Test with curl first
4. Check Cloudflare Workers logs
5. Create an issue with reproduction steps

## ⚡ Performance Tips

1. **Use appropriate image sizes**: Don't proxy unnecessarily large images
2. **Leverage caching**: Images are cached for 1 hour at the edge
3. **Monitor usage**: Keep track of bandwidth usage in Cloudflare dashboard
4. **Optimize allowlist**: Only add domains you actually need
5. **Use HEAD requests**: For checking image availability without downloading
