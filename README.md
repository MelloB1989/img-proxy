# Hono Image Proxy

A secure, high-performance image proxy service built with Hono and deployed on Cloudflare Workers. This service allows you to proxy images through your own domain while maintaining security through host allowlisting and proper CORS handling.

## 🚀 Features

- **Secure Host Allowlisting**: Only proxy images from pre-approved domains
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

3. **Update Configuration**

   Edit `wrangler.toml`:
   ```toml
   name = "your-image-proxy-name"
   main = "src/index.ts"
   compatibility_date = "2024-01-01"
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

## 🛠️ Usage Examples

### JavaScript/TypeScript

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

# Test valid image
curl "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/test.jpg"

# Test invalid host
curl "https://your-worker.workers.dev/img?url=https%3A//evil.com/image.jpg"

# Test HEAD request
curl -I "https://your-worker.workers.dev/img?url=https%3A//media.licdn.com/dms/image/test.jpg"
```

## 📝 Changelog

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
