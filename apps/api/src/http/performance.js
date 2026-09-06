const compression = require('compression');
const requestMetrics = [];

function requestMetricPath(request) {
  const baseUrl = String(request.baseUrl || '').replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 80);
  const routePath = typeof request.route?.path === 'string'
    ? request.route.path.replace(/[^A-Za-z0-9/:._-]/g, '').slice(0, 160)
    : '';
  return routePath ? `${baseUrl}${routePath}` : 'unmatched-route';
}

const responseCompression = compression({
  level: 6,
  threshold: 1024,
  filter(request, response) {
    if (request.headers['x-no-compression']) return false;
    if (String(response.getHeader('content-type') || '').includes('text/event-stream')) return false;
    return compression.filter(request, response);
  }
});

function recordRequestTiming(request, response, next) {
  const startedAt = process.hrtime.bigint();
  let responseBytes = 0;
  const originalWrite = response.write;
  const originalEnd = response.end;
  const originalWriteHead = response.writeHead;
  response.write = function writeWithSize(chunk, ...args) {
    if (chunk) responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return originalWrite.call(this, chunk, ...args);
  };
  response.end = function endWithSize(chunk, ...args) {
    if (chunk) responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return originalEnd.call(this, chunk, ...args);
  };
  response.writeHead = function writeHeadWithTiming(...args) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (!response.hasHeader('server-timing')) {
      response.setHeader('server-timing', `orbit-api;dur=${durationMs.toFixed(1)}`);
    }
    return originalWriteHead.apply(this, args);
  };
  response.once('finish', () => {
    requestMetrics.push({
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      method: request.method,
      path: requestMetricPath(request),
      responseBytes,
      status: response.statusCode,
      recordedAt: new Date().toISOString()
    });
    if (requestMetrics.length > 500) requestMetrics.splice(0, requestMetrics.length - 500);
  });
  next();
}

const getApiRequestMetrics = () => requestMetrics.slice();

module.exports = { getApiRequestMetrics, recordRequestTiming, requestMetricPath, responseCompression };
