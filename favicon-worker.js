export default {
  async fetch(request) {
    const response = await fetch(request);

    // Only rewrite HTML responses
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return response;
    }

    return new HTMLRewriter()
      .on('head', {
        element(head) {
          head.append(
            '<link rel="icon" type="image/png" href="https://nooutco.me/N-O.png">',
            { html: true }
          );
        },
      })
      .transform(response);
  },
};
