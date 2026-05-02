export default () => ({
  openai: {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
  },
  botpress: {
    webhookId: process.env.BOTAGENT_KEY,
    /**
     * Controls how the server delivers Botpress messages to the client.
     *   sse  (default) – long-lived SSE stream via listenConversation()
     *   poll           – client-driven polling via GET /ai-agents/messages/:id
     * Switch by setting BOTPRESS_DELIVERY_MODE=poll in your .env
     */
    deliveryMode: (process.env.BOTPRESS_DELIVERY_MODE || 'sse') as 'sse' | 'poll',
  },
});
