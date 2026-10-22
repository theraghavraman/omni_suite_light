/* Omni Suite Social Resolver configuration.
 * After deploying social-resolver/, paste its HTTPS base URL here.
 * Example: window.OMNI_SOCIAL_RESOLVER_URL = 'https://omni-social-resolver.onrender.com';
 */
window.OMNI_SOCIAL_RESOLVER_URL = '';
/* Optional. If you set SOCIAL_TOKEN on the Render service, paste the same value here so the
 * studio can reach /api/resolve. This value ships in the public page, so it is not a secret:
 * it is a rotatable gate that, with the service's per-IP rate limit, stops the resolver being
 * used as an open download proxy. Rotate it on the service and here to cut off abuse. */
window.OMNI_SOCIAL_RESOLVER_TOKEN = '';
