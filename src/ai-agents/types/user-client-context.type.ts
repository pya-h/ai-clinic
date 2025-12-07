import * as chat from '@botpress/chat';

export type TConversationListener = Awaited<
  ReturnType<chat.AuthenticatedClient['listenConversation']>
>;

export interface IUserContext {
  client: chat.AuthenticatedClient;
  conversationId?: string;
  listener?: TConversationListener;
}
