(function registerPortableSlopClient(global) {
  function createSlopFilterClient(baseUrl) {
    const root = String(baseUrl || 'http://127.0.0.1:8743').replace(/\/+$/, '');

    async function request(path, payload) {
      const response = await fetch(`${root}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error || `Request failed with status ${response.status}`;
        throw new Error(message);
      }
      return data;
    }

    return {
      async slopCheck(payload) {
        return request('/api/v1/slop-check', payload);
      },
    };
  }

  global.createSlopFilterClient = createSlopFilterClient;
})(window);
