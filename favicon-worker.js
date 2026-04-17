export default {
  async fetch(request) {
    const response = await fetch(request);

    // Only rewrite HTML responses
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return response;
    }

    return new HTMLRewriter()
      // Remove any existing favicon links so subdomain icons can't override
      .on('link[rel*="icon"]', {
        element(el) {
          el.remove();
        },
      })
      // Inject our favicon at the top of <head> so it loads first
      .on('head', {
        element(head) {
          head.prepend(
            '<link rel="icon" type="image/png" href="https://nooutco.me/N-O.png">',
            { html: true }
          );
        },
      })
      .transform(response);
  },
};
