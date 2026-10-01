// Builds the Caddyfile for the private HTTPS origin. Paths use forward slashes so Windows
// paths (C:\\Users\\...) are valid inside Caddy's quoted strings.
export function buildCaddyfile({ origin, ip, cert, key, nodePort }) {
  const q = (p) => String(p).replaceAll("\\", "/");
  return `{
 auto_https off
 admin off
 log {
  level ERROR
 }
}
${origin} {
 bind ${ip}
 tls "${q(cert)}" "${q(key)}"
 reverse_proxy 127.0.0.1:${nodePort} {
  flush_interval -1
 }
}
`;
}
